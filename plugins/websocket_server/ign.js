/*
 * Copyright (C) 2020 Open Source Robotics Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

function buildMsg(_frameParts) {
  return _frameParts.join(',');
}

/// \brief The main interface to the Ignition websocket server and 
/// data on Ignition Transport.
function Ignition(options) {
  options = options || {};

  this.socket = null;
  this.topics = [];
  this.isConnected = false;

  // Start with a null root protobuf object. This object will be 
  // created when we get the set of protobuf definitions from the server.
  this.root = null;

  if (options.url) {
    this.connect(options.url);
  }
}
Ignition.prototype.__proto__ = EventEmitter2.prototype;

/// \brief Connect to the specified WebSocket.
/// \param url - WebSocket URL for Ignition HTTPServer
Ignition.prototype.connect = function(url) {
  var that = this;

  /// \brief Emits a 'connection' event on WebSocket connection.
  /// \param event - the argument to emit with the event.
  function onOpen(event) {
    that.socket.send(buildMsg(["protos",'','','']));
  }

  /// \brief Emits a 'close' event on WebSocket disconnection.
  /// \param event - the argument to emit with the event.
  function onClose(event) {
    that.isConnected = false;
    that.emit('close', event);
  }

  /// \brief Emits an 'error' event whenever there was an error.
  /// \param event - the argument to emit with the event.
  function onError(event) {
    that.emit('error', event);
  }

  /// \brief Parses message responses from ignition and sends to the
  /// appropriate topic.
  // \param message - the JSON message from the Ignition
  // httpserver.
  function onMessage(_message) {
    if (that.root === undefined || that.root === null) {
      // Read the Blob as an array buffer
      var f = new FileReader();

      f.onloadend = function(event) {
        // This is the proto message data
        var contents = event.target.result;
        that.root = protobuf.parse(contents, {keepCase: true}).root;
        that.isConnected = true;
        that.emit('connection', event);

        // Request the list of topics on start.
        that.socket.send(buildMsg(['topics','','','']));
      };

      // Read the blob data as an array buffer.
      f.readAsText(_message.data);
      return;
    }

    var f = new FileReader();
    f.onloadend = function(event) {
      // Decode as UTF-8 to get the header
      var str = new TextDecoder("utf-8").decode(event.target.result);
      const frameParts = str.split(',');
      var msgType = that.root.lookup(frameParts[2]);
      var buf = new Uint8Array(event.target.result);

      // Decode the message. The "+3" in the slice accounts for the commas
      // in the frame.
      var msg = msgType.decode(
        buf.slice(frameParts[0].length + frameParts[1].length +
          frameParts[2].length+3));

      // Handle the topic list special case.
      if (frameParts[1] == 'topics') {
        that.topics = msg.data;
      } else {
        // This will pass along the message on the appropriate topic.
        that.emit(frameParts[1], msg);
      }
    }
    // Read the blob data as an array buffer.
    f.readAsArrayBuffer(_message.data);
  }

  this.socket = new WebSocket(url);
  this.socket.onopen = onOpen;
  this.socket.onclose = onClose;
  this.socket.onerror = onError;
  this.socket.onmessage = onMessage;
};

/// \brief Send a message to the websocket server
/// \param[in] _msg Message to send
Ignition.prototype.sendMsg = function(_msg) {
  var that = this;

  var emitter = function(msg){
    that.socket.send(msg);
  };

  // Wait for a connection before sending the message.
  if (!this.isConnected) {
    that.on('connection', function() {
      emitter(_msg);
    });
  } else {
    emitter(_msg);
  }
};

/// \brief Interface to Ignition Transport topics.
function Topic(options) {
  options = options || {};
  this.ign = options.ign; 
  this.name = options.name;
  this.messageType = options.messageType;
  this.isAdvertised = false;

  // Subscribe immediately if the callback is specified.
  if (options.callback) {
    this.subscribe(options.callback);
  }
}
Topic.prototype.__proto__ = EventEmitter2.prototype

// \brief Every time a message is published for the given topic, the callback
// will be called with the message object.
// \param[in] callback - function with the following params:
//   * message - the published message
Topic.prototype.subscribe = function(_callback) {
  var that = this;

  var emitter = function(_cb) {
    // Register the callback with the topic name
    that.ign.on(that.name, _cb);

    // Send the subscription message over the websocket.
    that.ign.sendMsg(buildMsg(['sub', that.name, '', '']));
  }

  if (!this.ign.isConnected) {
    this.ign.on('connection', function() {
      emitter(_callback);
    });
  } else {
    emiiter(_callback);
  }
};
