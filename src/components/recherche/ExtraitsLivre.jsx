import { useEffect, useState } from 'react'
import { rechercher, extraitsParPage } from '../../lib/pagefind'
import { url } from '../../lib/url'
import ExtraitTranscription from './ExtraitTranscription.jsx'

// Tranches de 20 pages chargées par carte (un fragment Pagefind chacune)
const TRANCHES_PAR_CARTE = 3

/**
 * Meilleurs passages d'un livre pour la requête, chargés à l'affichage de la
 * carte : seuls les fragments des tranches les plus pertinentes sont téléchargés.
 * Chaque passage ouvre la page correspondante du livre (#page-<index>).
 * onPages({ nb, exact }) : pages trouvées dans les tranches chargées ; exact si
 * toutes les tranches trouvées du livre (nbTranches) l'ont été.
 */
export default function ExtraitsLivre({ livreId, slug, requete, motsIndexes, nbTranches, onPages, max = 3 }) {
  const [extraits, setExtraits] = useState(null)

  useEffect(() => {
    let annule = false
    setExtraits(null)
    rechercher(requete, { filters: { livre: livreId } }, TRANCHES_PAR_CARTE)
      .then(({ donnees }) => {
        if (annule) return
        const pages = donnees.flatMap(d => extraitsParPage(d, requete, motsIndexes))
        onPages?.({ nb: pages.length, exact: donnees.length >= nbTranches })
        // Pages les plus riches en occurrences d'abord (tri stable : ordre de pertinence)
        setExtraits(pages.toSorted((a, b) => b.occurrences - a.occurrences).slice(0, max))
      })
      .catch(() => { if (!annule) setExtraits([]) })
    return () => { annule = true }
  }, [livreId, requete, motsIndexes, nbTranches, onPages, max])

  if (extraits === null) return <p className="extraits-chargement">Chargement des passages…</p>
  if (extraits.length === 0) return null

  return (
    <div className="extraits-container">
      {extraits.map(extrait => (
        <a key={extrait.page} className="extrait-lien" href={url(`/livres/${slug}/#page-${extrait.page}`)}>
          <ExtraitTranscription extrait={extrait} />
        </a>
      ))}
    </div>
  )
}
