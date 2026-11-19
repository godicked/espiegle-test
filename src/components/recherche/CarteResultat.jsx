import { useState } from 'react'
import ExtraitsLivre from './ExtraitsLivre.jsx'
import { url } from '../../lib/url'
import '../../styles/carte-resultat.css'

function estFiltreActif(meta, livre, filtres) {
  const filtre = filtres[meta.key]
  if (!filtre || (Array.isArray(filtre) && filtre.length === 0)) return false
  const valeur = String(livre[meta.key] ?? '')
  if (meta.type === 'select') return Array.isArray(filtre) && filtre.includes(valeur)
  if (meta.type === 'range') return Array.isArray(filtre) && (Number(valeur) >= filtre[0] && Number(valeur) <= filtre[1])
  if (meta.type === 'text') return !!filtre && valeur.toLowerCase().includes(String(filtre).toLowerCase())
  return false
}

/**
 * livre._nbTranches : nombre de tranches de pages de la transcription qui
 * contiennent la requête (0 sans requête ou si seules les métadonnées correspondent).
 * Le nombre de pages est connu une fois les extraits chargés (ExtraitsLivre).
 */
export default function CarteResultat({ livre, colonnesMeta, filtresActifs, requete, motsIndexes }) {
  const auteurs = Array.isArray(livre.auteur) ? livre.auteur.join(', ') : livre.auteur
  const RESERVEES = new Set(['id', 'titre', 'sous_titre', 'auteur', 'manifeste_url'])
  const metaSupp = colonnesMeta.filter(m => !RESERVEES.has(m.key))
  const nbTranches = livre._nbTranches ?? 0
  const [pages, setPages] = useState(null)   // { nb, exact } une fois les extraits chargés

  return (
    <div className={`carte-resultat${nbTranches > 0 ? ' carte-resultat--transcription' : ''}`}>
      <a href={url(`/livres/${livre.slug}`)} className="carte-resultat-lien-titre">
        <div className="carte-resultat-entete">
          <div className="carte-resultat-icone">
            <span className="material-icons">menu_book</span>
          </div>
          <div className="carte-resultat-info">
            <h3 className="carte-resultat-titre">{livre.titre}</h3>
            {livre.sous_titre && <p className="carte-resultat-sous-titre">{livre.sous_titre}</p>}
            <p className="carte-resultat-auteur">{auteurs}</p>
          </div>
          <span className="material-icons carte-resultat-fleche">chevron_right</span>
        </div>
      </a>
      <div className="carte-resultat-details">
        <div className="carte-resultat-chips">
          {metaSupp.map(m => {
            const actif = estFiltreActif(m, livre, filtresActifs)
            return (
              <span key={m.key} className={`chip${actif ? ' chip--actif' : ''}`}>
                <strong>{m.label}</strong>&nbsp;{String(livre[m.key] ?? '')}
              </span>
            )
          })}
          {nbTranches > 0 && (
            <span className="chip chip--actif">
              <span className="material-icons" style={{ fontSize: '13px' }}>history_edu</span>
              {pages === null ? 'Trouvé dans la transcription'
                : pages.nb === 0 ? (pages.exact ? 'Termes trouvés sur des pages voisines' : 'Trouvé dans la transcription')
                : `${pages.exact ? '' : 'Au moins '}${pages.nb} page${pages.nb > 1 ? 's' : ''} trouvée${pages.nb > 1 ? 's' : ''}`}
            </span>
          )}
        </div>
        {nbTranches > 0 && (
          <ExtraitsLivre livreId={livre.id} slug={livre.slug} requete={requete} motsIndexes={motsIndexes}
            nbTranches={nbTranches} onPages={setPages} />
        )}
      </div>
    </div>
  )
}
