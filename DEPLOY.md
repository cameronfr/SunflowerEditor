# Deploying both sites
1. node buildOrRun build
2. cd cloudflare && wranger publish

# Deploying yjs-server 
( Not strictly necessary, but apparently 30% of clients can't directly connect via webrtc)
1. apt-get install nginx
2. install nvm
3. nvm install stable
4. node i y-websocket
5. edit /etc/nginx/sites.../default to proxy_pass to 127.0.0.1:1234 (IMPORTANT: not localhost:1234, this screws things up)
6. run certbot
7. HOST=0.0.0.0 PORT=1234 npx y-websocket-server &
8. cloudflare dns to instance ip; firewall rules allow 80 and 443 on gcp

