# Watesly production — copy to /etc/caddy/Caddyfile on DigitalOcean server

watesly.com {
	redir https://www.watesly.com{uri} permanent
}

www.watesly.com {
	reverse_proxy 127.0.0.1:8080
}

api.watesly.com {
	reverse_proxy 127.0.0.1:8000
}

files.watesly.com {
	reverse_proxy 127.0.0.1:9000
}
