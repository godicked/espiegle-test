// BASE_URL vaut "/espiegle" ou "/espiegle/" selon la config : on normalise pour éviter "//" ou "espieglelivres"
export const url = (path: string) => {
    const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
    return `${base}/${path.replace(/^\/+/, '')}`
}
