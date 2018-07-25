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
    var sid = req.headers['x-id']
    if (sid == null) {
        res.statusCode = 503
        res.setHeader('content-type', "text/html")
        res.write("<html><body><pre>" +
            "Your request does not include expected headers.\n\n" +
            "We can't process your request for security reason.\n\n" +
            "</pre></body></html>")
        res.end()
        return
    }
    if (sid == 0) {
        var sess = new Session()
        res.setHeader('x-id', sess.sid)
        sess.connect(req, res)
        return
    }
    var sess = sessions[sid]
    if (!sess) {
        res.statusCode = 404
        res.end()
        return
    }
    sess.idle = 0
    if (req.headers['x-close']) {
        sess.close()
        res.statusCode = 200
        res.end()
    }
    if (req.method == 'GET') {
        sess.handle_dn(req, res)
    }
    if (req.method == 'POST') {
        sess.handle_up(req, res)
    }
}).listen(port)

var sessions = {}

class Session {
    constructor() {
        var sid = String(Math.random())
        sessions[sid] = this
        this.sid = sid
        this.idle = 0
        console.log("new session " + sid)
    }

    connect(req, res) {
        this.sock = net.connect(to_port, to_host, () => {
            if (!res.finished) {
                res.statusCode = 200
                res.end()
            }
        })
        this.sock.on('error', e => {
            console.error(e)
            if (!res.finished) {
                res.statusCode = 404
                res.end()
            }
        })
        this.sock.on('data', data => this.ondata(data))
        this.sock.on('end', () => this.close())
        this.pending = []
        this.pending_length = 0
        console.log("start session " + this.sid)
    }

    close() {
        console.log("close session " + this.sid)
        this.sock.destroy()
        if (this.dn_res && !this.dn_res.finished) {
            this.dn_res.statusCode = 205
            this.dn_res.end()
        }
    }

    handle_up(req, res) {
        req.pipe(this.sock, { end: false })
        req.on('end', () => {
            res.statusCode = 200
            res.end()
        })
    }

    handle_dn(req, res) {
        this.dn_res = res
        if (this.pending_length > 0) {
            this.kick_dn()
            return
        }
        setTimeout(() => this.kick_dn(), 5000)
    }

    ondata(data) {
        if (data.length == 0) return
        this.pending.push(data)
        this.pending_length += data.length
        if (this.pending_length > 1000000) {
            this.sock.pause()
        }
        this.kick_dn()
    }

    kick_dn() {
        if (!this.dn_res) return
        if (this.dn_res.finished) return
        if (this.kicking) return
        this.kicking = true
        setTimeout(() => {
            this.kicking = false
            this.complete_dn()
        }, 5)
    }

    complete_dn() {
        var res = this.dn_res
        if (res.finished) return
        res.setHeader('Content-Length', this.pending_length)
        res.statusCode = 200
        for (var i = 0; i < this.pending.length; i++) {
            res.write(this.pending[i])
        }
        res.end()
        this.pending = []
        this.pending_length = 0
        this.sock.resume()
    }
}

function patrol() {
    for (sid in sessions) {
        var sess = sessions[sid]
        if (++sess.idle < 10) continue
        console.log("expiring session " + sid)
        sess.close()
        delete(sessions[sid])
    }
}

setInterval(patrol, 10000)
