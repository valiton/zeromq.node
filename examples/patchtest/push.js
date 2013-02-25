/*
 *
 * Pipeline
 *
 */

var zmq = require('../');
//var port = 'inproc://a';
//var port = 'tcp://127.0.0.1:12345';
var port = 'inproc://a';


  //push = upstream

  var socket = zmq.socket('push');

  socket.identity = 'upstream' + process.pid;
  console.log("gesocketopt 23:" + socket.getsockopt(23));
  socket.setsockopt(23, 5000);
  console.log("gesocketopt 23:" + socket.getsockopt(23));
  socket.bind(port, function(err) {
    if (err) throw err;
    console.log('bound!');

    gblcount = 0;

    refreshIntervalId = setInterval(function() {
      var date = new Date();

      gblcount +=1;

      if (gblcount % 10 == 0) {
        console.log(socket.identity + ' ' + date.toString() + " cnt:" + gblcount);
      }
      //try {
       console.log("send:" + JSON.stringify(socket.send(date.toString(),1)));
       //socket.send(date.toString(),1);
      //} catch (err) {
      //  console.log("err:" + err);
      //}

      //socket.send();
      if (gblcount > 100000) {
        clearInterval(refreshIntervalId);
      }
    }, 1);
  });
