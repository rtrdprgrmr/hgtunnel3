/*
Copyright (c) 2018 rtrdprgrmr

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

var net = require('net')
var crypto = require('crypto')
var http = require('http')
var url = require('url')

var port = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || 8000
var to_host = process.argv[2] || '127.0.0.1'
var to_port = +process.argv[3] || 22

http.createServer((req, res) => {
    var xid = req.headers['x-id']
    if (xid == null) {
        res.statusCode = 503
        res.setHeader('content-type', "text/html")
        res.write("<html><body><pre>" +
            "Your request does not include expected headers.\n\n" +
            "We can't process your request for security reason.\n\n" +
            "</pre></body></html>")
        res.end()
        return
    }
    if (xid == 0) {
        var sess = new Session()
        sess.connect(req, res)
        return
    }
    var sess = sessions[xid]
    if (!sess) {
        res.statusCode = 404
        res.end()
        return
    }
    sess.idle = 0
    if (req.method == 'GET') {
        sess.handle_dn(req, res)
    }
    if (req.method == 'POST') {
        sess.handle_up(req, res)
    }
}).listen(port)

var sessions = {}

function Session() {
    this.idle = 0

    var xid = String(Math.random())
    sessions[xid] = this
    console.log("new session " + xid)

    var sock
    var pending = []
    var pending_length = 0
    var closed = false
    var kicking = false
    var dn_res

    this.handle_up = (req, res) => {
        req.pipe(sock, { end: false })
        req.on('end', () => {
            res.statusCode = 200
            res.end()
            if (req.headers['x-close']) {
                sock.end()
            }
        })
    }

    this.handle_dn = (req, res) => {
        dn_res = res
        if (pending_length > 0) {
            kick_dn()
            return
        }
        setTimeout(kick_dn, 5000)
    }

    this.connect = (req, res) => {
        sock = net.connect(to_port, to_host, () => {
            if (!res.finished) {
                res.setHeader('x-id', xid)
                res.statusCode = 200
                res.end()
            }
            console.log("session connected " + xid)
        })
        this.sock = sock

        sock.on('error', e => {
            console.error(e)
            if (!res.finished) {
                res.statusCode = 404
                res.end()
            }
            console.log("session error " + xid)
        })

        sock.on('data', data => {
            if (data.length == 0) return
            pending.push(data)
            pending_length += data.length
            if (pending_length > 1000000) {
                sock.pause()
            }
            kick_dn()
        })

        sock.on('end', () => {
            closed = true
            kick_dn()
        })
    }

    function kick_dn() {
        if (!dn_res) return
        if (dn_res.finished) return
        if (kicking) return
        kicking = true
        setTimeout(() => {
            kicking = false
            send_dn()
        }, 5)
    }

    function send_dn() {
        if (closed) {
            console.log("session closed " + xid)
            var headers = { 'x-id': xid, 'x-close': true }
        } else {
            var headers = { 'x-id': xid }
        }
        dn_res.setHeader('Content-Length', pending_length)
        dn_res.statusCode = 200
        for (var i = 0; i < pending.length; i++) {
            dn_res.write(pending[i])
        }
        dn_res.end()
        pending = []
        pending_length = 0
        sock.resume()
    }
}

function patrol() {
    for (xid in sessions) {
        var sess = sessions[xid]
        if (++sess.idle > 10) continue
        console.log("expiring session " + xid)
        if (sess.sock) sess.sock.destroy()
        delete(sessions[xid])
    }
}

setInterval(patrol, 10000)
