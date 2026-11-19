/** Message affiché quand la saisie contient des mots vides, non cherchés dans les transcriptions. */
export const messageMotsIgnores = mots =>
  `${mots.length > 1 ? 'Mots trop fréquents ignorés' : 'Mot trop fréquent ignoré'} dans les transcriptions : ${mots.map(m => `« ${m} »`).join(', ')}`
