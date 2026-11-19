import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import fs from 'node:fs'
import path from 'node:path'
import { construireIndexRecherche } from './src/lib/indexRecherche.ts'

// Copie data/manifestes → <cible>/manifestes en réécrivant l'`id` IIIF sur l'URL réelle de service.
// Clover n'affiche pas les images si l'`id` du manifeste diffère de l'URL depuis laquelle il est chargé.
function copierManifestes(cible, prefixe) {
  const source = path.join(process.env.DATA_PATH ?? './data', 'manifestes')
  // Ne jamais supprimer/recréer le dossier : au redémarrage du serveur de dev, Vite
  // perd la trace des fichiers publics recréés et les sert en 404.
  fs.mkdirSync(cible, { recursive: true })

  const fichiers = fs.readdirSync(source).filter(f => f.endsWith('.json'))
  for (const fichier of fichiers) {
    const texte = fs.readFileSync(path.join(source, fichier), 'utf-8')
    const id = JSON.parse(texte).id ?? ''
    const ancien = id.slice(0, id.lastIndexOf('/'))   // ex: http://localhost:4321/manifestes
    const reecrit = ancien ? texte.replaceAll(`${ancien}/`, `${prefixe}/`) : texte
    const destination = path.join(cible, fichier)
    if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf-8') !== reecrit) {
      fs.writeFileSync(destination, reecrit)
    }
  }
  for (const obsolete of fs.readdirSync(cible).filter(f => !fichiers.includes(f))) {
    fs.rmSync(path.join(cible, obsolete))
  }
}

// En dev : écrit dans public/ (servi par Vite). Au build : écrit directement dans dist/,
// pour ne pas écraser les `id` localhost d'un serveur de dev lancé en parallèle.
function manifestes() {
  let base = ''
  let site = ''
  return {
    name: 'manifestes',
    hooks: {
      'astro:config:setup': ({ config, command }) => {
        base = config.base.replace(/\/+$/, '')
        site = String(config.site).replace(/\/+$/, '')
        if (command !== 'dev') return
        copierManifestes(
          path.join(new URL(config.publicDir).pathname, 'manifestes'),
          `http://localhost:${config.server.port}${base}/manifestes`,
        )
      },
      'astro:build:done': ({ dir }) => {
        copierManifestes(path.join(dir.pathname, 'manifestes'), `${site}${base}/manifestes`)
      },
    },
  }
}

// Copie les avatars data/membres → public/membres, servis tels quels en dev et repris
// dans dist/ au build. Comme pour les manifestes, le dossier n'est jamais recréé.
function membres() {
  return {
    name: 'membres',
    hooks: {
      'astro:config:setup': ({ config }) => {
        const source = path.join(process.env.DATA_PATH ?? './data', 'membres')
        const cible = path.join(new URL(config.publicDir).pathname, 'membres')
        fs.mkdirSync(cible, { recursive: true })

        const fichiers = fs.readdirSync(source).filter(f => f.endsWith('.webp'))
        for (const fichier of fichiers) fs.copyFileSync(path.join(source, fichier), path.join(cible, fichier))
        for (const obsolete of fs.readdirSync(cible).filter(f => !fichiers.includes(f))) {
          fs.rmSync(path.join(cible, obsolete))
        }
      },
    },
  }
}

// Index plein texte Pagefind (voir src/lib/indexRecherche.ts), chargé à la demande
// par les îles de recherche depuis <base>/pagefind/.
// Au build : écrit dans dist/pagefind. En dev : construit au démarrage dans
// .astro/pagefind (pas dans public/, cf. remarque ci-dessus) et servi par un middleware Vite.
const TYPES_PAGEFIND = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' }

function rechercheIndex() {
  let base = ''
  return {
    name: 'recherche-index',
    hooks: {
      'astro:config:setup': ({ config, command, updateConfig, logger }) => {
        base = config.base.replace(/\/+$/, '')
        if (command !== 'dev') return
        const dossier = path.resolve('.astro/pagefind')
        construireIndexRecherche(dossier)
          .then(({ livres, pages }) => logger.info(`index prêt : ${livres} livres, ${pages} pages`))
          .catch(e => logger.error(String(e)))
        // Plugin Vite `enforce: 'pre'` : le middleware passe avant celui d'Astro,
        // qui répondrait 404 (un middleware ajouté dans astro:server:setup arrive trop tard).
        updateConfig({ vite: { plugins: [{
          name: 'recherche-index-dev',
          enforce: 'pre',
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              const m = req.url.split('?')[0].match(new RegExp(`^(?:${base})?/pagefind(/.*)$`))
              if (!m) return next()
              const fichier = path.join(dossier, decodeURIComponent(m[1]))
              if (!fichier.startsWith(dossier + path.sep) || !fs.existsSync(fichier)) return next()
              res.setHeader('Content-Type', TYPES_PAGEFIND[path.extname(fichier)] ?? 'application/octet-stream')
              fs.createReadStream(fichier).pipe(res)
            })
          },
        }] } })
      },
      'astro:build:done': async ({ dir, logger }) => {
        const { livres, pages } = await construireIndexRecherche(path.join(dir.pathname, 'pagefind'))
        logger.info(`index écrit : ${livres} livres, ${pages} pages`)
      },
    },
  }
}

// URL publique du site, dont sont déduits site et base. SITE_URL est prioritaire :
// sur Huma-Num, CI_PAGES_URL ne contient pas le chemin /<projet> où le site est
// réellement servi, ce qui donnait base = '/' et des liens cassés.
// Hors CI (dev, build local), valeurs par défaut ci-dessous.
const urlPublique = process.env.SITE_URL || process.env.CI_PAGES_URL
const urlPages = urlPublique ? new URL(urlPublique) : null

export default defineConfig({
  site: urlPages?.origin ?? 'https://ceres.sorbonne-universite.fr',
  base: urlPages ? (urlPages.pathname.replace(/\/+$/, '') || '/') : '/Projo',
  integrations: [react(), manifestes(), membres(), rechercheIndex()],
  output: 'static',
})
