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
        this.sock.pause()
        console.log("start session " + this.sid)
    }

    close() {
        this.sock.destroy()
        console.log("close session " + this.sid)
    }

    handle_up(req, res) {
        req.pipe(this.sock, { end: false })
        req.on('end', () => {
            res.statusCode = 200
            res.end()
        })
    }

    handle_dn(req, res) {
        var sock = this.sock
        sock.once('data', data_listener)
        sock.once('end', end_listener)
        sock.resume()
        setTimeout(poll_listener, 5000)

        function data_listener(data) {
            if (res.finished) return
            sock.pause()
            sock.removeListener('end', end_listener)
            res.setHeader('Content-Length', data.length)
            res.statusCode = 200
            res.write(data)
            res.end()
        }

        function end_listener() {
            if (res.finished) return
            res.statusCode = 205
            res.end()
        }

        function poll_listener() {
            if (res.finished) return
            sock.pause()
            sock.removeListener('data', data_listener)
            sock.removeListener('end', end_listener)
            res.setHeader('Content-Length', 0)
            res.statusCode = 200
            res.end()
        }
    }
}

function patrol() {
    for (sid in sessions) {
        var sess = sessions[sid]
        sess.idle++
            if (sess.idle < 10) continue
        console.log("expiring session " + sid)
        sess.close()
        delete(sessions[sid])
    }
}

setInterval(patrol, 10000)
