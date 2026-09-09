const fs = require('fs');

const file = 'node_modules/whatsapp-web.js/src/util/Injected/Utils.js';

let source = fs.readFileSync(file, 'utf8');

source = source.replace(
  `cannotBeRanked: window
                        .require('WAWebStatusGatingUtils')
                        .canCheckStatusRankingPosterGating(),`,
  `cannotBeRanked: (() => {
                        try {
                            const gating = window.require('WAWebStatusGatingUtils');
                            return typeof gating?.canCheckStatusRankingPosterGating === 'function'
                                ? gating.canCheckStatusRankingPosterGating()
                                : false;
                        } catch {
                            return false;
                        }
                    })(),`
);

fs.writeFileSync(file, source);
console.log('Patched whatsapp-web.js status gating');
