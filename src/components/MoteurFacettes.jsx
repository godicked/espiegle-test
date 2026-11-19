/**
 * MoteurFacettes.jsx — orchestrateur du moteur de recherche à facettes.
 *
 * Facettes et métadonnées (titre, sous-titre, auteur) : filtrées dans le
 * navigateur. Le catalogue est chargé au montage depuis /recherche-donnees.json
 * (voir src/pages/recherche-donnees.json.ts), les définitions de facettes arrivent en props.
 * Plein texte : index Pagefind chargé à la demande (src/lib/pagefind.js),
 * restreint aux livres retenus par les facettes. Requête et texte passent par
 * la même normalisation (src/lib/normalisation.js + data/equivalences.tsv).
 */
import { useState, useMemo, useEffect } from 'react'
import { creerNormaliseur } from '../lib/normalisation'
import { url } from '../lib/url'
import { rechercher } from '../lib/pagefind'
import { telechargerResultats } from '../lib/exportCsv'
import { FacetteSelect, FacetteRange, FacetteTexte } from './recherche/Facettes.jsx'
import CarteResultat from './recherche/CarteResultat.jsx'
import { messageMotsIgnores } from './recherche/motsIgnores'
import '../styles/moteur-facettes.css'

// Cartes affichées par tranche : chacune charge ses passages à l'affichage.
const PAR_TRANCHE = 20

/** Catalogue en colonnes ({ colonnes, lignes }) → un objet par livre. */
const versLivres = ({ colonnes, lignes }) =>
  lignes.map(ligne => Object.fromEntries(colonnes.map((c, i) => [c, ligne[i]])))

export default function MoteurFacettes({ colonnesMeta, equivalences }) {
  const [livres, setLivres] = useState(null)   // null tant que le catalogue n'est pas chargé
  const [erreurCatalogue, setErreurCatalogue] = useState(false)
  const [recherche, setRecherche] = useState('')
  const [requete, setRequete] = useState('')   // normalisée, après la pause de frappe
  const [filtres, setFiltres] = useState({})
  const [pleinTexte, setPleinTexte] = useState({ requete: '', comptes: {}, erreur: false })
  const [nbAffiches, setNbAffiches] = useState(PAR_TRANCHE)

  const { motsNormalises, motsIndexes, normaliserRequete, motsIgnores } = useMemo(() => creerNormaliseur(equivalences), [equivalences])

  useEffect(() => {
    fetch(url('/recherche-donnees.json'))
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(donnees => setLivres(versLivres(donnees)))
      .catch(e => { console.error('[recherche] catalogue', e); setErreurCatalogue(true) })
  }, [])

  const majFiltres = (key, valeur) => setFiltres(prev => ({ ...prev, [key]: valeur }))
  const reinitialiser = () => { setRecherche(''); setFiltres({}) }

  useEffect(() => {
    const t = setTimeout(() => setRequete(normaliserRequete(recherche)), 250)
    return () => clearTimeout(t)
  }, [recherche, normaliserRequete])

  useEffect(() => setNbAffiches(PAR_TRANCHE), [requete, filtres])

  // Mots normalisés des métadonnées, pour la recherche dans titre, sous-titre et auteur
  const motsMeta = useMemo(() => new Map((livres ?? []).map(l => [l.id, motsNormalises(
    [l.titre, l.sous_titre, Array.isArray(l.auteur) ? l.auteur.join(' ') : l.auteur].filter(Boolean).join(' ')
  )])), [livres, motsNormalises])

  const livresFiltres = useMemo(() => (livres ?? []).filter(livre =>
    colonnesMeta.every(meta => {
      const filtre = filtres[meta.key]
      if (!filtre || (Array.isArray(filtre) && filtre.length === 0)) return true
      const valeur = String(livre[meta.key] ?? '')
      if (meta.type === 'select') return filtre.includes(valeur)
      if (meta.type === 'range') return Number(valeur) >= filtre[0] && Number(valeur) <= filtre[1]
      if (meta.type === 'text') return valeur.toLowerCase().includes(String(filtre).toLowerCase())
      return true
    })
  ), [livres, colonnesMeta, filtres])

  // Nombre de tranches de pages trouvées par livre (un enregistrement Pagefind par
  // tranche, voir indexRecherche.ts), parmi les livres retenus par les facettes
  useEffect(() => {
    if (!requete || livresFiltres.length === 0) return
    let annule = false
    rechercher(requete, { filters: { livre: { any: livresFiltres.map(l => l.id) } } })
      .then(r => { if (!annule) setPleinTexte({ requete, comptes: r.filters.livre ?? {}, erreur: false }) })
      .catch(e => {
        if (annule || e.name === 'AbortError') return
        console.error('[recherche]', e)
        setPleinTexte({ requete, comptes: {}, erreur: true })
      })
    return () => { annule = true }
  }, [requete, livresFiltres])

  const enCours = requete !== '' && livresFiltres.length > 0 && pleinTexte.requete !== requete

  const resultats = useMemo(() => {
    if (!requete) return livresFiltres.map(l => ({ ...l, _nbTranches: 0 }))
    const termes = requete.replaceAll('"', ' ').split(/\s+/).filter(Boolean)
    const comptes = pleinTexte.requete === requete ? pleinTexte.comptes : {}
    return livresFiltres
      .map(l => {
        const mots = motsMeta.get(l.id)
        const dansMeta = termes.every(t => mots.some(m => m.startsWith(t)))
        return { ...l, _dansMeta: dansMeta, _nbTranches: comptes[l.id] ?? 0 }
      })
      .filter(l => l._dansMeta || l._nbTranches > 0)
      .sort((a, b) => (b._dansMeta - a._dansMeta) || (b._nbTranches - a._nbTranches))
  }, [requete, livresFiltres, motsMeta, pleinTexte])

  const ignores = useMemo(() => motsIgnores(recherche), [recherche, motsIgnores])

  const nbFiltresActifs = Object.values(filtres).filter(v =>
    v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
  ).length

  return (
    <div className="moteur">
      <div className="recherche-barre">
        <span className="material-icons recherche-icone">search</span>
        <input
          className="recherche-input"
          type="text"
          placeholder="Rechercher dans le titre ou la transcription (phrase exacte entre guillemets)"
          value={recherche}
          onChange={e => setRecherche(e.target.value)}
          autoFocus
        />
        {(recherche || nbFiltresActifs > 0) && (
          <button className="recherche-reset" onClick={reinitialiser} title="Réinitialiser">
            <span className="material-icons">close</span>
          </button>
        )}
      </div>

      <div className="moteur-corps">
        <aside className="facettes-panneau carte">
          <div className="facettes-entete">
            <h2 className="facettes-titre">Filtres</h2>
            {nbFiltresActifs > 0 && (
              <button className="facettes-reset" onClick={() => setFiltres({})}>
                Réinitialiser ({nbFiltresActifs})
              </button>
            )}
          </div>
          {colonnesMeta.filter(meta => meta.filtrable).map(meta => {
            if (meta.type === 'select') return <FacetteSelect key={meta.key} meta={meta} valeurActive={filtres[meta.key]} onChange={v => majFiltres(meta.key, v)} />
            if (meta.type === 'range') return <FacetteRange key={meta.key} meta={meta} valeurActive={filtres[meta.key]} onChange={v => majFiltres(meta.key, v)} />
            return <FacetteTexte key={meta.key} meta={meta} valeurActive={filtres[meta.key]} onChange={v => majFiltres(meta.key, v)} />
          })}
        </aside>

        <section className="resultats">
          <div className="resultats-entete">
            <p className="resultats-compteur">
              <strong>{resultats.length}</strong> résultat{resultats.length !== 1 ? 's' : ''}
              {livres && livres.length !== resultats.length && ` sur ${livres.length}`}
              {enCours && ' · recherche dans les transcriptions…'}
              {pleinTexte.erreur && pleinTexte.requete === requete && ' · recherche dans les transcriptions indisponible'}
            </p>
            {resultats.length > 0 && (
              <button
                className="btn-telecharger"
                onClick={() => telechargerResultats(resultats, colonnesMeta)}
                title="Télécharger les résultats (CSV)"
              >
                <span className="material-icons">download</span>
                Télécharger
              </button>
            )}
          </div>
          {ignores.length > 0 && <p className="resultats-ignores">{messageMotsIgnores(ignores)}</p>}
          {livres === null ? (
            <div className="resultats-vide carte">
              <span className="material-icons">{erreurCatalogue ? 'error_outline' : 'hourglass_empty'}</span>
              <p>{erreurCatalogue ? 'Catalogue indisponible.' : 'Chargement du catalogue…'}</p>
            </div>
          ) : resultats.length === 0 && !enCours ? (
            <div className="resultats-vide carte">
              <span className="material-icons">search_off</span>
              <p>Aucun résultat pour ces critères.</p>
              <button className="btn btn-outlined" onClick={reinitialiser}>Réinitialiser la recherche</button>
            </div>
          ) : (
            <div className="resultats-liste">
              {resultats.slice(0, nbAffiches).map(livre => (
                <CarteResultat
                  key={livre.id}
                  livre={livre}
                  colonnesMeta={colonnesMeta}
                  filtresActifs={filtres}
                  requete={requete}
                  motsIndexes={motsIndexes}
                />
              ))}
              {resultats.length > nbAffiches && (
                <button className="btn btn-outlined resultats-plus" onClick={() => setNbAffiches(n => n + PAR_TRANCHE)}>
                  Afficher plus ({resultats.length - nbAffiches} restants)
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
