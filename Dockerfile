# syntax=docker/dockerfile:1

# Image de production d'UN serveur MCP du monorepo, choisi au build :
#
#   docker build --build-arg SERVER=paie-fr -t mcp-paie-fr .
#
# SERVER est le nom du dossier dans servers/. Le contexte est toujours la
# racine du dépôt : pnpm a besoin du lockfile et du workspace, et le serveur
# a besoin du kit (packages/mcp-kit).
#
# Deux étapes : build (dépendances, TypeScript, paquet autonome) puis
# runtime (image minimale, utilisateur non-root, sans npm ni pnpm).

# Image de base écrite en entier et épinglée par digest : build reproductible,
# et Dependabot peut proposer les mises à jour (il ne résout pas les ARG).
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS build
# pnpm vient de corepack, à la version de "packageManager" (package.json
# racine) : une seule source de vérité, en local, en CI et ici.
RUN corepack enable
WORKDIR /repo

# 1. Téléchargement des dépendances. `pnpm fetch` ne lit que le lockfile :
#    cette couche reste en cache tant qu'il ne change pas, même si le code
#    change. Pas de cache mount ici : en CI (cache GitHub Actions), un cache
#    mount n'est pas conservé entre deux runs, et l'install hors ligne
#    ci-dessous échouerait.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# 2. Installation hors ligne, limitée au serveur demandé et à ce dont il
#    dépend : `{dossier}...` = ce paquet et ses dépendances du workspace (le
#    kit). Les accolades comptent : sans elles, pnpm ne prend que le dossier.
COPY . .
ARG SERVER
RUN test -n "$SERVER" && test -f "servers/$SERVER/package.json" \
    || { echo "Build arg SERVER must name a folder of servers/ (e.g. --build-arg SERVER=paie-fr)" >&2; exit 1; }
RUN pnpm install --offline --frozen-lockfile --filter "{./servers/${SERVER}}..."

# 3. Compilation dans l'ordre des dépendances (le kit, puis le serveur), puis
#    paquet autonome : le serveur, ses dépendances de production et le kit
#    compilé copié dedans. Ni sources, ni outils de build, ni autres serveurs.
#    Pas de --offline pour `deploy` : pnpm 11 vérifie le lockfile réduit du
#    paquet contre ses politiques supply-chain, ce qui lit les métadonnées du
#    registre. Les paquets eux-mêmes viennent du store rempli par `fetch`.
#    Le chmod rend l'image indépendante des droits du poste qui construit
#    (un fichier en 600 sur le disque resterait illisible pour l'uid 1001).
RUN pnpm --filter "{./servers/${SERVER}}..." run build \
 && pnpm --filter "./servers/${SERVER}" deploy --prod /prod \
 && chmod -R a+rX,go-w /prod

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Aucun gestionnaire de paquets au runtime : le serveur se lance avec `node`,
# et quelqu'un qui obtiendrait une exécution de code n'a rien pour installer.
# (Gain de sécurité, pas de taille : les couches Docker sont additives.)
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 # uid/gid 1001 : ceux qu'impose le compose sur le VPS (convention d'infra).
 && addgroup -S -g 1001 mcp \
 && adduser -S -D -H -u 1001 -G mcp mcp

WORKDIR /app
# Fichiers possédés par root et lancés par un autre utilisateur : le process
# ne peut pas modifier son propre code (compatible read-only).
COPY --from=build /prod ./
COPY --chmod=0644 LICENSE ./
USER 1001:1001
EXPOSE 3000
# --start-interval : sonde toutes les 2 s pendant le démarrage, pour que le
# déploiement voie « healthy » en quelques secondes et non après 30 s.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/http.js"]
