import { useState, useMemo, useEffect } from 'react'
import { creerNormaliseur } from '../../lib/normalisation'
import { rechercher, extraitsParPage } from '../../lib/pagefind'
import ExtraitTranscription from './ExtraitTranscription.jsx'
import { messageMotsIgnores } from './motsIgnores'
import '../../styles/recherche-livre.css'

// Passages affichés au plus
const MAX_EXTRAITS = 30
// Tranches de 20 pages chargées au plus (un fragment Pagefind chacune) : toutes,
// sauf livre de plus de 2 000 pages
const MAX_TRANCHES = 100

/**
 * Recherche plein-texte dans l'ouvrage en cours de visualisation, via l'index
 * Pagefind filtré sur ce livre. Au clic sur un résultat, émet
 * `transcription:goto { index }`, écouté par le script inline de /livres/[slug]
 * qui affiche la page dans le mode actif et synchronise le viewer IIIF.
 * index = position de la page dans la transcription (= canvas IIIF).
 */
export default function RechercheLivre({ livreId, equivalences }) {
  const [saisie, setSaisie] = useState('')
  const [etat, setEtat] = useState({ requete: '', total: 0, extraits: [], erreur: false })

  const { motsIndexes, normaliserRequete, motsIgnores } = useMemo(() => creerNormaliseur(equivalences), [equivalences])
  const requete = normaliserRequete(saisie)

  useEffect(() => {
    if (!requete) return
    let annule = false
    const t = setTimeout(async () => {
      try {
        // Tranches dans l'ordre de pertinence de Pagefind, pages dans l'ordre du livre
        const { donnees } = await rechercher(requete, { filters: { livre: livreId } }, MAX_TRANCHES)
        const pages = donnees.flatMap(d => extraitsParPage(d, requete, motsIndexes))
        if (!annule) setEtat({ requete, total: pages.length, extraits: pages.slice(0, MAX_EXTRAITS), erreur: false })
      } catch (e) {
        if (annule || e.name === 'AbortError') return
        console.error('[recherche]', e)
        setEtat({ requete, total: 0, extraits: [], erreur: true })
      }
    }, 250)
    return () => { annule = true; clearTimeout(t) }
  }, [requete, livreId, motsIndexes])

  const allerALaPage = (index) => {
    window.dispatchEvent(new CustomEvent('transcription:goto', { detail: { index } }))
  }

  const aJour = etat.requete === requete
  const ignores = motsIgnores(saisie)
  const { total, extraits } = etat

  return (
    <div className="recherche-livre">
      <div className="recherche-livre-barre">
        <span className="material-icons recherche-livre-icone">manage_search</span>
        <input
          className="recherche-livre-input"
          type="text"
          placeholder="Rechercher dans cet ouvrage…"
          value={saisie}
          onChange={e => setSaisie(e.target.value)}
        />
        {saisie && (
          <button className="recherche-livre-reset" onClick={() => setSaisie('')} title="Effacer la recherche">
            <span className="material-icons">close</span>
          </button>
        )}
      </div>

      {saisie.trim() && !requete && ignores.length > 0 && (
        <div className="recherche-livre-resultats carte">
          <p className="recherche-livre-compteur">{messageMotsIgnores(ignores)}</p>
        </div>
      )}

      {requete && (
        <div className="recherche-livre-resultats carte">
          <p className="recherche-livre-compteur">
            {!aJour ? 'Recherche…'
              : etat.erreur ? 'Recherche indisponible.'
              : total === 0 ? 'Aucun passage trouvé.'
              : <><strong>{total}</strong> page{total > 1 ? 's' : ''} trouvée{total > 1 ? 's' : ''}{total > extraits.length && ` (${extraits.length} premières)`} — cliquez pour afficher la page</>}
          </p>
          {aJour && extraits.length > 0 && (
            <ul className="recherche-livre-liste">
              {extraits.map(extrait => (
                <li key={extrait.page}>
                  <button
                    className="recherche-livre-resultat"
                    onClick={() => allerALaPage(extrait.page)}
                    title={`Aller à la page ${extrait.n}`}
                  >
                    <ExtraitTranscription extrait={extrait} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
