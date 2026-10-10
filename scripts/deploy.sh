#!/usr/bin/env bash
set -euo pipefail
umask 077

app_root=/opt/paige-express
service=paige-express.service
release_id="${1:?A release ID is required.}"
archive="${2:?A release archive is required.}"

if [[ ! "$release_id" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]]; then
  echo "Invalid release ID." >&2
  exit 1
fi
if [[ "$archive" != "$app_root/releases/$release_id.tar.gz" ]]; then
  echo "Invalid release archive path." >&2
  exit 1
fi

exec 9> "$app_root/.deploy.lock"
if ! flock -n 9; then
  echo "Another deployment is already running." >&2
  exit 1
fi

[[ -L "$app_root/current" ]]
previous_release="$(readlink -f "$app_root/current")"
[[ "$previous_release" == "$app_root/releases/"* && -d "$previous_release" ]]
[[ -r "$app_root/shared/.env" ]]
[[ -r "$app_root/shared/data/guild-settings.json" ]]
[[ -r "$app_root/shared/data/news-state.json" ]]
[[ -f "$archive" ]]
node -e 'if (process.versions.node.split(".")[0] !== "24") process.exit(1)'
sudo -n -l /usr/bin/systemctl restart paige-express.service > /dev/null
sudo -n -l /usr/bin/journalctl -u paige-express.service -n 100 -o json --no-pager > /dev/null

release_dir="$app_root/releases/$release_id"
link_path="$app_root/.current-$release_id"
completed=false

switch_release() {
  ln -s "$1" "$link_path"
  mv -Tf -- "$link_path" "$app_root/current"
}

is_ready() {
  systemctl is-active --quiet "$service" || return 1
  local invocation
  invocation="$(systemctl show "$service" --property=InvocationID --value)" || return 1
  [[ -n "$invocation" ]] || return 1
  sudo -n /usr/bin/journalctl -u paige-express.service -n 100 -o json --no-pager |
    node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const invocation = process.argv[1];
      const messages = readFileSync(0, "utf8").trim().split("\n")
        .filter(Boolean).map(line => JSON.parse(line))
        .filter(entry => entry._SYSTEMD_INVOCATION_ID === invocation)
        .map(entry => typeof entry.MESSAGE === "string" ? entry.MESSAGE : "");
      const connected = messages.some(message => message.startsWith("Connected to Discord as "));
      const deliveryStarted = messages.some(message => message.startsWith("Steam news delivery started."));
      process.exit(connected && deliveryStarted ? 0 : 1);
    ' "$invocation"
}

wait_until_ready() {
  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if is_ready; then
      return 0
    fi
    sleep 3
  done
  echo "The bot did not connect to Discord and start news delivery within 60 seconds." >&2
  return 1
}

finish() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ "$completed" != true && "$(readlink -f "$app_root/current")" == "$release_dir" ]]; then
    echo "Deployment failed. Restoring $previous_release." >&2
    if switch_release "$previous_release" &&
      sudo -n /usr/bin/systemctl restart paige-express.service &&
      wait_until_ready; then
      echo "The previous release is running." >&2
    else
      echo "Rollback requires attention. Check paige-express.service on the VPS." >&2
    fi
    status=1
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 1' HUP INT TERM

mkdir "$release_dir"
tar -xzf "$archive" -C "$release_dir"
cd "$release_dir"
npm ci --omit=dev
[[ -f dist/index.js && -f assets/news_fallback.png ]]
ln -s "$app_root/shared/.env" "$release_dir/.env"
ln -s "$app_root/shared/data" "$release_dir/data"

switch_release "$release_dir"
sudo -n /usr/bin/systemctl restart paige-express.service
wait_until_ready
completed=true
echo "Deployed $release_id. Discord is connected and news delivery has started."

# Keep release directories for rollback; remove only this deployment's upload files.
if ! rm -f -- "$archive" "$app_root/releases/$release_id.deploy.sh"; then
  echo "The release is running, but its uploaded files need manual cleanup." >&2
fi
