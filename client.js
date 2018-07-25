/*
Copyright (c) 2018 rtrdprgrmr

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

var net = require('net')
var http = require('http')
var url = require('url')

var remote_url = process.argv[2]
var local_port = process.argv[3] || '8888'
var proxy = process.env.http_proxy

if (!remote_url) {
    console.log("usage:\texport http_proxy=http://proxy-ip:proxy-port")
    console.log("\tnode client http://remote-ip:remote-port [local_port]")
    process.exit(1)
}

if (proxy) {
    console.log("will connect to " + remote_url + " via " + proxy)
    var obj = url.parse(proxy)
    var path = remote_url
    var host = obj.hostname
    var port = obj.port || 80
} else {
    console.log("will connect to " + remote_url)
    var obj = url.parse(remote_url)
    var path = obj.path
    var host = obj.hostname
    var port = obj.port || 80
}

function http_request(method, headers, data, callback) {
    if (callback == null) {
        callback = data
        data = []
    }
    var length = 0
    for (var i = 0; i < data.length; i++) {
        length += data[i].length
    }
    headers['Content-Length'] = length
    headers['Connection'] = 'Keep-Alive'
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    headers['Pragma'] = 'no-cache'
    headers['Expires'] = '0'
    var req = http.request({ method, path, host, port, headers }, callback)
    for (var i = 0; i < data.length; i++) {
        req.write(data[i])
    }
    req.end()
    req.on('error', e => {
        console.error(e)
        callback({})
    })
}

net.createServer(function(sock) {
    var xid
    var pending = []
    var pending_length = 0
    var closed = false
    var kicking = false
    sock.on('error', console.error)

    http_request('GET', { 'x-id': '0' }, res => {
        if (res.statusCode != 200) sock.destroy()
        if (sock.destroyed) return
        xid = res.headers['x-id']
        console.log("connection open " + xid)
        recv_dn()
        kick_up()
    })

    function recv_dn() {
        http_request('GET', { 'x-id': xid }, res => {
            if (res.statusCode != 200) sock.destroy()
            if (sock.destroyed) return
            if (res.headers['x-close']) {
                res.pipe(sock)
                return
            }
            res.pipe(sock, { end: false })
            res.on('end', recv_dn)
        })
    }

    sock.on('data', data => {
        if (data.length == 0) return
        pending.push(data)
        pending_length += data.length
        if (pending_length > 1000000) {
            sock.pause()
        }
        kick_up()
    })

    sock.on('end', () => {
        closed = true
        kick_up()
    })

    function kick_up() {
        if (!xid) return
        if (kicking) return
        kicking = true
        setTimeout(send_up, 1)
    }

    function send_up() {
        if (pending_length == 0 && !closed) {
            kicking = false
            return
        }
        if (closed) {
            console.log("connection closed " + xid)
            var headers = { 'x-id': xid, 'x-close': true }
        } else {
            var headers = { 'x-id': xid }
        }
        var data = pending
        pending = []
        pending_length = 0
        sock.resume()
        http_request('POST', headers, data, res => {
            if (headers['x-close']) return
            send_up()
        })
    }

}).listen(local_port)
