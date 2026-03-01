import { ref, onUnmounted } from 'vue';
import { io, Socket } from 'socket.io-client';

const socket = ref<Socket | null>(null);
const connected = ref(false);

export function useWebSocket() {
  if (!socket.value) {
    const s = io(window.location.origin, {
      transports: ['websocket', 'polling'],
    });

    s.on('connect', () => {
      connected.value = true;
    });

    s.on('disconnect', () => {
      connected.value = false;
    });

    socket.value = s;
  }

  return {
    socket: socket.value,
    connected,
  };
}
