# CLAIMS — registre des prises (local-first, miroir des commentaires GitHub)

Protocole : lire top issue #35 avant de prendre. CLAIM en <60s
(commentaire + assignee si réseau), puis ajouter ligne ci-dessous et pusher
la branche vide. La branche distante `agent/*/<n>-*` fait foi en cas de conflit.
Case `- [ ]` = prise active, `- [x]` = libérée/mergée.

| Issue | Branche | Agent/ rôle | Date UTC | Statut |
| ----- | ------- | ----------- | -------- | ------ |
| #35 | `agent/guardian/35-parallel-coordination` | coordination | 2026-10-02 | pris (noyau : AGENTS.md, CLAIMS.md, branching.md, launch.sh) |
| #4 | `agent/dev-server/4-contracts-api` | dev-server | 2026-10-02 | - [ ] prise active (shared/contracts, phase 1) |
| #10 | `agent/dev-server/10-server-http-api` | dev-server | 2026-10-02 | - [ ] prise active (server/api, phase 3) |
| #12 | `agent/dev-server/12-server-pairing` | dev-server | 2026-10-02 | - [ ] prise active (server/api pairing, phase 3) |
| #16 | `agent/dev-server/16-sync-moteur` | dev-server | 2026-10-02 | - [ ] prise active (server/jobs, phase 5) |
| #17 | `agent/dev-server/17-sync-delta-notes` | dev-server | 2026-10-02 | - [ ] prise active (server/jobs diff, phase 5) |
| #5 | `agent/guardian/5-architecture-guards` | guardian | 2026-10-02 | pris |
| #24 | `agent/dev-server/24-jobs-ds` | dev-server | 2026-10-02 | - [ ] prise active (server/jobs DS, phase 7) |
| #6 | `agent/dev-server/6-pronote-http-client` | dev-server | 2026-10-02 | pris |
| #11 | `agent/dev-server/11-server-storage` | dev-server | 2026-10-02 | pris |
| #7 | `agent/dev-server/7-pronote-auth` | dev-server | 2026-10-02 | - [ ] prise active (server/integrations auth ENT/CAS, phase 2) |
| #22 | `agent/dev-server/22-push-infra` | dev-server | 2026-10-02 | - [ ] prise active (server/push, phase 7) |
| #19 | `agent/guardian/19-pipeline-untrusted` | guardian | 2026-10-02 | pris |
| #8 | `agent/dev-server/8-pronote-lectures` | dev-server | 2026-10-02 | - [ ] prise active (server/integrations lectures notes/devoirs/EDT, phase 2) |
| #25 | `agent/dev-server/25-manuels-scrape` | dev-server | 2026-10-02 | - [ ] prise active (server/infrastructure manuals scrape, phase 8) |
