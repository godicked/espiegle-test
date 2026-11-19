import type { APIRoute } from 'astro'
import { getLivres, aTranscription, getTranscriptionXml } from '../../lib/parseData'

// Expose le XML source de chaque transcription en fichier statique
// (/transcriptions/<slug>.xml) pour le bouton de téléchargement de la page livre.
// Rien n'est copié si XML_DEPOT_URL est définie : la page livre pointe alors
// directement vers le XML publié dans le dépôt de données.
export function getStaticPaths() {
  if (process.env.XML_DEPOT_URL) return []
  return getLivres()
    .filter(livre => aTranscription(livre.id))
    .map(livre => ({ params: { slug: livre.slug }, props: { id: livre.id } }))
}

export const GET: APIRoute = ({ props }) =>
  new Response(getTranscriptionXml(props.id as string), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
