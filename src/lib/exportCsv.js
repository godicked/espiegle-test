/**
 * exportCsv.js — téléchargement des résultats de recherche au format CSV.
 * Une ligne par livre : métadonnées, nombre de tranches de 20 pages où la requête a été
 * trouvée (le nombre exact de pages n'est connu qu'en chargeant les extraits) et lien.
 * La transcription n'est pas incluse (téléchargeable en XML depuis chaque page livre).
 */
import { url } from './url'

export function telechargerResultats(resultats, colonnesMeta) {
  const escapeCsv = val => {
    const s = String(val ?? '')
    return (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes(';'))
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }

  const RESERVEES = new Set(['id', 'titre', 'sous_titre', 'auteur', 'manifeste_url'])
  const colonnesExtra = colonnesMeta.filter(m => !RESERVEES.has(m.key))
  const entetes = ['id', 'titre', 'sous_titre', 'auteur', ...colonnesExtra.map(m => m.key), 'tranches_20_pages_trouvees', 'lien']

  const lignes = [
    entetes.join(','),
    ...resultats.map(livre => entetes.map(col => {
      if (col === 'tranches_20_pages_trouvees') return livre._nbTranches ?? 0
      if (col === 'lien') return escapeCsv(new URL(url(`/livres/${livre.slug}/`), location.origin).href)
      if (col === 'auteur') return escapeCsv(Array.isArray(livre.auteur) ? livre.auteur.join('; ') : (livre.auteur ?? ''))
      return escapeCsv(livre[col])
    }).join(','))
  ]

  const blob = new Blob(['﻿' + lignes.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'resultats.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}
