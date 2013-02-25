/*
 *
 * Pipeline
 *
 */

var cluster = require('cluster');
var zmq = require('../');
//var port = 'tcp://127.0.0.1:12345';
var port = 'inproc://a';

var pullcount = 0;


  //pull = downstream

  var socket = zmq.socket('pull');

  socket.identity = 'downstream' + process.pid;

  socket.connect(port);
  console.log('connected!');

  socket.on('message', function(data) {
    pullcount += 1;
    console.log(socket.identity + ': received data ' + data.toString() + ":" + pullcount);
  });

