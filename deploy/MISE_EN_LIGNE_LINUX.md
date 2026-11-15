# Mise en ligne sur Linux Mint (serveur perso + domaine OVH)

Les commandes sont à lancer sur le serveur. Les chemins supposent l'utilisateur `alex` et le projet dans `/home/alex/prono` ; adapte-les dans `deploy/prono-bmx.service` et `deploy/backup.sh` si besoin.

## 1. Le portable doit rester allumé

Linux Mint met un portable en veille quand on ferme l'écran. Pour l'en empêcher :

```bash
sudo sed -i 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/; s/^#\?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

Dans les paramètres de Mint (Gestion de l'alimentation), mets aussi « mise en veille » sur Jamais. Garde le portable branché.

## 2. Installer Node.js et récupérer le projet

```bash
sudo apt update && sudo apt install -y nodejs git
node --version
git clone https://github.com/TON-COMPTE/Prono_BMX.git ~/prono
mkdir -p ~/prono/prono-data
```

(Si le dépôt est privé, utilise une clé SSH ou un jeton GitHub pour le clone.)

## 3. Lancer l'application en permanence

```bash
sudo cp ~/prono/deploy/prono-bmx.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now prono-bmx
systemctl status prono-bmx
```

Elle redémarre toute seule après une panne ou un redémarrage du portable. Les logs : `journalctl -u prono-bmx -f`.

## 4. Nom de domaine chez OVH

Dans la zone DNS OVH, ajoute un enregistrement **A** (par exemple `prono.tondomaine.fr`) qui pointe vers l'adresse IP publique de ta box (visible sur https://ifconfig.me).

Si ton IP publique change (c'est fréquent chez les particuliers), utilise **DynHost** : dans OVH, Domaines > ton domaine > DynHost, crée un identifiant, puis installe `ddclient` sur le portable pour qu'il mette l'IP à jour tout seul (protocole « dyndns2 », serveur `www.ovh.com`).

## 5. Ouvrir la box

Dans l'interface de ta box, redirige les ports **80** et **443** (TCP) vers l'adresse locale du portable (réserve-lui une adresse fixe dans la box pour qu'elle ne change pas).

Si la box n'a pas d'IP publique dédiée (CGNAT, fréquent en 4G/5G ou chez certains opérateurs), la redirection est impossible : il faudra passer par un tunnel (par exemple Cloudflare Tunnel) ou un petit serveur loué.

## 6. HTTPS avec Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Le certificat vient de **Let's Encrypt** (gratuit, renouvelé automatiquement tous les ~60 jours, sans rien à faire). Édite `deploy/Caddyfile` : remplace `prono.exemple.fr` par ton domaine et `toi@exemple.fr` par ton adresse mail. Puis :

```bash
sudo cp ~/prono/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Ouvre `https://prono.tondomaine.fr` : le cadenas apparaît après quelques secondes.

## 7. Pare-feu

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

L'application elle-même n'écoute que sur 127.0.0.1 : seul Caddy peut lui parler.

## 8. Sauvegardes

```bash
chmod +x ~/prono/deploy/backup.sh
( crontab -l 2>/dev/null; echo "0 4 * * * /home/alex/prono/deploy/backup.sh" ) | crontab -
```

Une copie par nuit est gardée dans `~/prono/prono-data/sauvegardes` (15 dernières). Copie aussi ce dossier de temps en temps sur un autre support : si le disque du portable lâche, les sauvegardes sur le même disque partent avec.

## 9. Mettre à jour l'application

```bash
cd ~/prono && git pull && sudo systemctl restart prono-bmx
```

## Premier lancement

Crée tout de suite le compte organisateur (le premier compte créé l'est), puis ferme les inscriptions quand les joueurs sont inscrits.
