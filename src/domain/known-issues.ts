/**
 * Écarts connus entre la version publiée de modele-social (npm) et le
 * simulateur en production sur mon-entreprise.urssaf.fr.
 *
 * Principe : on ne corrige jamais une règle à la main (ce serait réécrire
 * le moteur), mais on ne cache pas non plus un écart connu. Il est signalé
 * dans le champ `warnings` des résultats concernés.
 *
 * Indexé par version : quand on monte de version, les avertissements
 * disparaissent d'eux-mêmes. Le test de version épinglée oblige à relire
 * ce fichier à chaque montée.
 */
import { RULES_SOURCE } from './engine.js'

interface KnownIssues {
  employerCost: readonly string[]
}

const BY_VERSION: Record<string, KnownIssues> = {
  '11.1.0': {
    // Corrigé en amont dans la section "next" du CHANGELOG, pas encore publié sur npm :
    // « Utilisation du Smic au 1er janvier 2026 dans les calculs de la RGDU et de la Lodeom ».
    employerCost: [
      'modele-social 11.1.0 computes the general contribution reduction (RGDU) with the June 2026 minimum wage (SMIC); ' +
        'the live URSSAF simulator uses the January 2026 SMIC (fix published upstream, not yet released on npm). ' +
        'For salaries up to about 3× SMIC, the employer cost may be understated by roughly €5 to €110 per month.',
    ],
  },
}

export const KNOWN_ISSUES: KnownIssues = BY_VERSION[RULES_SOURCE.modele_social_version] ?? { employerCost: [] }
