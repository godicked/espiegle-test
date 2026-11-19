"""Génère un faux corpus de test (CSV + XML de transcription) pour tester build et recherche.

Usage : python3 faux_corpus.py --sources <dossier txt> --data <data réel> --sortie <dossier> [--n 600] [--seed 1]

Le dossier de sortie est un DATA_PATH complet : copie des vraies données + N faux ouvrages
(id faux.NNNN) dont les images pointent vers les manifestes réels (colonne manifeste_url).

Texte : assemblage de passages (5-40 mots) de vrais textes anciens (Wikisource), puis variation
par ouvrage (graphies, bruit d'OCR, coupures de fin de ligne, noms propres) pour que le
vocabulaire croisse comme dans un vrai corpus au lieu de plafonner à celui des sources.
"""
import argparse, csv, glob, math, os, random, re, shutil
from xml.sax.saxutils import escape

p = argparse.ArgumentParser()
p.add_argument('--sources', required=True)
p.add_argument('--data', required=True)
p.add_argument('--sortie', required=True)
p.add_argument('--n', type=int, default=600)
p.add_argument('--seed', type=int, default=1)
p.add_argument('--echelle-pages', type=float, default=1.0, help='multiplie le nombre de pages (tests rapides)')
args = p.parse_args()
R = random.Random(args.seed)

# ---------------------------------------------------------------- données réelles
if os.path.exists(args.sortie):
    shutil.rmtree(args.sortie)
shutil.copytree(args.data, args.sortie, ignore=shutil.ignore_patterns('images', '*.xlsx', 'nakala_cache.json', 'scripts'))
manifestes = sorted(f'/manifestes/{os.path.basename(f)}' for f in glob.glob(os.path.join(args.data, 'manifestes', '*.json')))

# ---------------------------------------------------------------- sources
BRUIT = re.compile(r'wikisource|exporté|^\s*[\d\W]*\s*$|modifier|←|→|ISBN|http', re.I)
documents = []
for f in sorted(glob.glob(os.path.join(args.sources, '*.txt'))):
    lignes = open(f, encoding='utf-8').read().split('\n')[1:]
    mots = ' '.join(l for l in lignes if not BRUIT.search(l)).split()
    if len(mots) >= 300:
        documents.append(mots)
assert documents, 'aucune source'
poids = [len(d) for d in documents]
print(f'{len(documents)} documents source, {sum(poids):,} mots')


def passage(docs, w):
    d = R.choices(docs, weights=w)[0]
    n = R.randint(5, 40)
    i = R.randrange(max(1, len(d) - n))
    return d[i:i + n]


# ---------------------------------------------------------------- variation par ouvrage
CONSONNES_MUETTES = [(r'\bfait', 'faict'), (r'\bdoit', 'doibt'), (r'\bdit\b', 'dict'), (r'\bescri', 'escri'),
                     (r'\bécri', 'escri'), (r'\bét', 'est'), (r'\bsa(v|u)', r'sça\1'), (r'\bnuit', 'nuict'),
                     (r'\bmoins\b', 'moings'), (r'\btemps\b', 'tems'), (r'\bpoint\b', 'poinct')]
GRAPHIES = [(r'ait\b', 'oit'), (r'aient\b', 'oyent'), (r'ais\b', 'ois'), (r'i\b', 'y'), (r'é\b', 'ez'),
            (r'és\b', 'ez'), (r'\bé', 'e'), (r'ou', 'ov'), (r'll', 'l'), (r'([^l])l([aeiou])', r'\1ll\2'),
            (r'ss', 's'), (r'ent\b', 'ens'), (r'an', 'ã'), (r'om', 'õ'), (r'que\b', 'q̃'), (r'ille', 'ile')]
CONFUSIONS = [('e', 'c'), ('c', 'e'), ('n', 'u'), ('u', 'n'), ('rn', 'm'), ('m', 'rn'), ('l', 'i'), ('i', 'l'),
              ('ſ', 'f'), ('f', 'ſ'), ('h', 'b'), ('a', 'o'), ('t', 'r'), ('ri', 'n')]
SYLLABES = 'ar bel ca dor el fa gar her il ja lo mar nan or pa quin ro sal tre ul val zan bor mau ger lin ver fran cis gau'.split()


def nom_propre():
    return ''.join(R.choice(SYLLABES) for _ in range(R.randint(2, 3))).capitalize()


class Profil:
    def __init__(self):
        self.graphies = [(re.compile(a), b, R.random() * 0.5) for a, b in R.sample(GRAPHIES, R.randint(3, 9))]
        self.muettes = [(re.compile(a), b, R.random()) for a, b in R.sample(CONSONNES_MUETTES, R.randint(0, 8))]
        self.s_long = R.random() < 0.6           # ſ médial
        self.ocr = R.choice([0, 0.002, 0.01, 0.02, 0.04])
        self.coupure = R.uniform(0.05, 0.25)    # mot coupé en fin de ligne
        self.noms = [nom_propre() for _ in range(R.randint(5, 40))]
        self.p_nom = R.uniform(0.002, 0.012)

    def mot(self, m):
        if R.random() < self.p_nom:
            return R.choice(self.noms)
        for rx, rep, pr in self.graphies + self.muettes:
            if R.random() < pr:
                m = rx.sub(rep, m)
        if self.s_long and 's' in m[:-1]:
            m = re.sub(r's(?=\w)', 'ſ', m)
        if self.ocr and R.random() < self.ocr * 5:
            a, b = R.choice(CONFUSIONS)
            if a in m:
                k = R.choice([i for i in range(len(m)) if m.startswith(a, i)])
                m = m[:k] + b + m[k + len(a):]
        return m


# ---------------------------------------------------------------- mise en page
def lignes_de(mots, profil, largeur):
    """Découpe en lignes de ~largeur mots, avec coupures « melanco- / liques »."""
    out, cur, i = [], [], 0
    while i < len(mots):
        cur.append(mots[i]); i += 1
        if len(cur) >= largeur + R.randint(-2, 2):
            dernier = cur[-1]
            if len(dernier) >= 7 and dernier.isalpha() and R.random() < profil.coupure:
                k = R.randint(3, len(dernier) - 3)
                cur[-1] = dernier[:k] + '-'
                mots.insert(i, dernier[k:])
            out.append(' '.join(cur)); cur = []
    if cur: out.append(' '.join(cur))
    return out


def page_historique(n, mots, profil, titre_courant):
    x = [f'  <Page n="{n}">']
    if R.random() < 0.7:
        x.append('    <Header>')
        if R.random() < 0.8: x.append(f'      <PageNumber>{n}</PageNumber>')
        x.append(f'      <Heading type="running"><Line>{escape(titre_courant)}</Line></Heading>')
        x.append('    </Header>')
    x.append('    <Body>')
    if not mots:
        x.append('      <Gap reason="illegible" extent="Full page" />' if R.random() < .5 else
                 '      <Figure><Description>Woodcut ornament.</Description></Figure>')
    i = 0
    while i < len(mots):
        bloc = mots[i:i + R.randint(25, 120)]; i += len(bloc)
        r = R.random()
        if r < 0.07:
            x.append(f'      <Heading type="section"><Line>{escape(" ".join(bloc[:R.randint(2, 8)]))}</Line></Heading>')
            bloc = bloc[8:]
        if r > 0.95:
            x.append('      <Figure><Description>Woodcut illustration.</Description></Figure>')
        balise = 'BlockQuotation' if R.random() < 0.05 else 'Paragraph'
        x.append(f'      <{balise}>')
        for l in lignes_de(bloc, profil, R.randint(6, 9)):
            l = escape(l)
            if R.random() < 0.03: l = f'<Italic>{l}</Italic>'
            x.append(f'        <Line>{l}</Line>')
        x.append(f'      </{balise}>')
    if mots and R.random() < 0.5:
        x.append(f'      <Catchword>{escape(mots[-1][:6])}</Catchword>')
    x.append('    </Body>')
    x.append('  </Page>')
    return '\n'.join(x)


def page_defaut(n, mots, profil):
    x = [f'  <page n="{n}">']
    i = 0
    while i < len(mots):
        bloc = mots[i:i + R.randint(30, 150)]; i += len(bloc)
        parts = []
        for m in bloc:
            m2 = escape(m)
            if m in profil.noms and R.random() < 0.6: m2 = f'<persName>{m2}</persName>'
            elif R.random() < 0.004: m2 = f'<placeName>{m2}</placeName>'
            elif R.random() < 0.01: m2 = f'<hi rend="italic">{m2}</hi>'
            parts.append(m2)
        x.append('    <paragraphe>' + ' '.join(parts) + '</paragraphe>')
        if R.random() < 0.03:
            x.append(f'    <note>{escape(" ".join(passage(documents, poids)))}</note>')
    x.append('  </page>')
    return '\n'.join(x)


# ---------------------------------------------------------------- métadonnées
ADJ = ['Facetieuses', 'Plaisantes', 'Joyeuses', 'Recreatives', 'Nouvelles', 'Gaillardes', 'Admirables', 'Curieuses',
       'Agreables', 'Morales', 'Tragiques', 'Comiques', 'Memorables', 'Divertissantes', 'Subtiles']
NOMS = ['Nouvelles', 'Histoires', 'Devis', 'Contes', 'Serees', 'Recreations', 'Journées', 'Nuits', 'Fables',
        'Apophtegmes', 'Rencontres', 'Discours', 'Propos', 'Matinées', 'Facéties', 'Entretiens']
COMPL = ['de la cour', 'du temps present', 'des bonnes compagnies', 'pour chasser la melancolie',
         'des dames', 'du voyageur', 'des bons esprits', 'contre l’oisiveté', 'de ce temps', 'des marchands']
VILLES = ['Paris', 'Lyon', 'Rouen', 'Troyes', 'Anvers', 'Geneve', 'Amsterdam', 'Cologne', 'La Haye', 'Bruxelles']

reel = list(csv.DictReader(open(os.path.join(args.data, 'metadata.csv'), encoding='utf-8-sig')))
colonnes = [c for c in reel[0].keys() if c] + ['manifeste_url']
editeurs = sorted({r['Editeur'] for r in reel if r['Editeur'] and r['Editeur'] != '0'})

lignes_csv = [{k: v for k, v in r.items() if k} for r in reel]
os.makedirs(os.path.join(args.sortie, 'transcriptions'), exist_ok=True)
total_mots = 0
for k in range(1, args.n + 1):
    fid = f'faux.{k:04d}'
    titre_gen = f'Les {R.choice(ADJ)} {R.choice(NOMS)} {R.choice(COMPL)}'
    auteur = f'{nom_propre()} {R.choice(["de ", "du ", "", ""])}{nom_propre()}'
    date = R.randint(1480, 1720)
    for e in range(1 + (R.randint(0, 6) if R.random() < 0.4 else 0)):
        lignes_csv.append({
            'id': fid if e == 0 else '', 'auteur': auteur, 'Titre Générique': titre_gen,
            'titre': f'{titre_gen}, {R.choice(["reveuës et augmentees", "mises en lumiere", "nouvellement imprimees"])} par {auteur}',
            'Date Premiere éd.': str(date), 'Date édition numérisée': f'{date + 3 * e}.00',
            'Editeur': R.choice(editeurs), 'Date': '', 'manifeste_url': R.choice(manifestes) if e == 0 else '',
        })

    # contenu : quelques documents « parents » donnent la couleur de l'ouvrage
    parents = R.sample(range(len(documents)), min(len(documents), R.randint(2, 8)))
    docs = [documents[i] for i in parents] + documents
    w = [poids[i] * 20 for i in parents] + poids
    profil = Profil()
    nb_pages = max(20, min(900, int(R.lognormvariate(math.log(230), 0.55) * args.echelle_pages)))
    historique = R.random() < 0.6
    pages = []
    for n in range(1, nb_pages + 1):
        cible = 0 if R.random() < 0.04 else max(15, int(R.gauss(155, 50)))
        mots = []
        while len(mots) < cible:
            mots += passage(docs, w)
        mots = [profil.mot(m) for m in mots[:cible]]
        total_mots += len(mots)
        pages.append(page_historique(n, mots, profil, titre_gen.upper()) if historique else page_defaut(n, mots, profil))
    if historique:
        xml = '<?xml version=\'1.0\' encoding=\'utf-8\'?>\n<HistoricalDocument xmlns="http://example.com/historicaldocument">\n' \
              + '\n'.join(pages) + '\n</HistoricalDocument>\n'
    else:
        xml = '<?xml version=\'1.0\' encoding=\'utf-8\'?>\n<transcription>\n' + '\n'.join(pages) + '\n</transcription>\n'
    open(os.path.join(args.sortie, 'transcriptions', f'{fid}.xml'), 'w', encoding='utf-8').write(xml)
    if k % 50 == 0:
        print(f'{k}/{args.n} ouvrages, {total_mots:,} mots', flush=True)

with open(os.path.join(args.sortie, 'metadata.csv'), 'w', encoding='utf-8', newline='') as f:
    wr = csv.DictWriter(f, fieldnames=colonnes, extrasaction='ignore')
    wr.writeheader()
    wr.writerows(lignes_csv)
print(f'terminé : {args.n} ouvrages, {total_mots:,} mots → {args.sortie}')
