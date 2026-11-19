import type { APIRoute } from 'astro'
import { getLivres, getLivreAvecTranscription } from '../../../../lib/parseData'
import { nbTranches, htmlTranche } from '../../../../lib/tranches'

// Tranches de la transcription (/livres/<slug>/tranches/<n>.html), chargées à la
// demande par la page livre. La tranche 0 est dans la page elle-même.
export function getStaticPaths() {
  return getLivres().flatMap(livre => {
    const nb = nbTranches(getLivreAvecTranscription(livre.id)?.transcriptionPages.length ?? 0)
    return Array.from({ length: Math.max(0, nb - 1) }, (_, i) => ({
      params: { slug: livre.slug, tranche: String(i + 1) },
      props: { id: livre.id },
    }))
  })
}

export const GET: APIRoute = ({ params, props }) => {
  const pages = getLivreAvecTranscription(props.id as string)?.transcriptionPages ?? []
  return new Response(htmlTranche(pages, Number(params.tranche)), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
