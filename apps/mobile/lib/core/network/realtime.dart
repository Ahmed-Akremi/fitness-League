import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as sio;

/// Live events from the API WebSocket `/ws` (docs §4.5): new notifications and battle score changes.
abstract class Realtime {
  Stream<Map<String, dynamic>> get notifications;
  Stream<String> get battleScores;
  void connect();
  void disconnect();
  void subscribeBattle(String battleId);
  void unsubscribeBattle(String battleId);
}

/// Tests, demo build and signed-out state: nothing live, screens fall back to polling.
class NoopRealtime implements Realtime {
  @override
  Stream<Map<String, dynamic>> get notifications => const Stream.empty();
  @override
  Stream<String> get battleScores => const Stream.empty();
  @override
  void connect() {}
  @override
  void disconnect() {}
  @override
  void subscribeBattle(String battleId) {}
  @override
  void unsubscribeBattle(String battleId) {}
}

class SocketRealtime implements Realtime {
  SocketRealtime({required String apiBaseUrl, required this.token}) : _url = '${Uri.parse(apiBaseUrl).origin}/ws';

  final String _url;
  final String? Function() token;
  final _notifications = StreamController<Map<String, dynamic>>.broadcast();
  final _battleScores = StreamController<String>.broadcast();
  final Set<String> _battles = {};
  sio.Socket? _socket;

  @override
  Stream<Map<String, dynamic>> get notifications => _notifications.stream;
  @override
  Stream<String> get battleScores => _battleScores.stream;

  @override
  void connect() {
    if (_socket != null || token() == null) return;
    final s = sio.io(_url, sio.OptionBuilder().setTransports(['websocket']).setAuth({'token': token()}).disableAutoConnect().enableReconnection().build());
    // The access token rotates: every reconnection uses the current one.
    s.onReconnectAttempt((_) => s.auth = {'token': token()});
    s.onConnect((_) {
      for (final id in _battles) {
        s.emit('battle.subscribe', {'battleId': id});
      }
    });
    s.on('notification.new', (data) {
      if (data is Map) _notifications.add(data.cast<String, dynamic>());
    });
    s.on('battle.score', (data) {
      if (data is Map && data['battleId'] is String) _battleScores.add(data['battleId'] as String);
    });
    _socket = s..connect();
  }

  @override
  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }

  @override
  void subscribeBattle(String battleId) {
    _battles.add(battleId);
    _socket?.emit('battle.subscribe', {'battleId': battleId});
  }

  @override
  void unsubscribeBattle(String battleId) {
    _battles.remove(battleId);
    _socket?.emit('battle.unsubscribe', {'battleId': battleId});
  }
}
