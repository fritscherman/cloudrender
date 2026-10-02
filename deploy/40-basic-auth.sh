#!/bin/sh
# Optional server-side password: set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD
# in Coolify's environment variables. Without them the page is served openly
# (the page's own password prompt still shows, but it is client-side only).
set -e
if [ -n "$BASIC_AUTH_USER" ] && [ -n "$BASIC_AUTH_PASSWORD" ]; then
  printf '%s:%s\n' "$BASIC_AUTH_USER" "$(openssl passwd -apr1 "$BASIC_AUTH_PASSWORD")" > /etc/nginx/.htpasswd
  printf 'auth_basic "Cloud Flight";\nauth_basic_user_file /etc/nginx/.htpasswd;\n' > /etc/nginx/auth.conf
  echo "basic auth: on (user $BASIC_AUTH_USER)"
else
  : > /etc/nginx/auth.conf
  echo "basic auth: off"
fi
