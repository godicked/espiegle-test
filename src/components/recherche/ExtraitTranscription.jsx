import '../../styles/extrait-transcription.css'

/**
 * Affiche un extrait de page avec les mots trouvés surlignés.
 * extrait : { segments: { texte, marque }[], n, coupeAvant, coupeApres }
 * (voir extraitsParPage dans src/lib/pagefind.js).
 */
export default function ExtraitTranscription({ extrait }) {
  const { segments, n, coupeAvant, coupeApres } = extrait
  return (
    <div className="extrait-transcription">
      <span className="material-icons extrait-icone">format_quote</span>
      <p className="extrait-texte">
        {coupeAvant && <span className="extrait-ellipse">…</span>}
        {segments.map((s, i) =>
          s.marque ? <mark key={i} className="extrait-mark">{s.texte}</mark> : s.texte
        )}
        {coupeApres && <span className="extrait-ellipse">…</span>}
        {n !== undefined && n !== null && <span className="extrait-page">p. {n}</span>}
      </p>
    </div>
  )
}
