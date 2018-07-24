tunneling tcp connection via http-get/post
==========================================

Diagram
-------

--(tcp)--> client.js --(http-get/post)--> server.js --(tcp)-->

Optionally proxy server can be inserted.

--(tcp)--> client.js --(http-get/post)--> proxy --> server.js --(tcp)-->

Usage
-----
```sh
node server to_host [to_port]
```

```sh
export http_proxy="http://proxy-ip:proxy-port"
node client remote_url [local_port]
```

