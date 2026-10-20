import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type KeyboardEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { buildWebSocketUrl } from '../api/client';
import { getAuthToken } from '../services/tokenStorage';
import { useToast } from '../context/ToastContext';
import { useAppTheme, type AppColors } from '../theme/AppTheme';
import type { UserSession } from '../types/telemetry';
import { newMessageId } from '../utils/chatIdentity';

interface ChatMessage {
  idMensaje: string;
  idEmisor: number;
  nombreEmisor: string;
  rolEmisor: string;
  idPilotoCanal: number;
  nombrePilotoCanal: string;
  contenido: string;
  tipoContenido?: string;
  fechaHora: string;
}

interface PilotItem { idUsuario: number; nombreCompleto: string; tipoRol: string; estado?: string }

interface PassengerConversation {
  idConversacion: string;
  idViaje: number;
  aliasPasajero: string;
  nombreRuta: string;
  unidad: string;
  fechaUltimaActividad: string;
  bloqueada: boolean;
  noLeidos: number;
  ultimoMensaje?: string;
}

interface PassengerMessage {
  idUsuarioEmisor?: number | null;
  idMensaje: string;
  idConversacion: string;
  tipoEmisor: 'Pasajero' | 'Piloto' | 'Operador';
  nombreEmisor: string;
  contenido: string;
  fechaHora: string;
  fechaLectura?: string;
}

interface BlockedUser {
  idUsuario: number;
  nombreCompleto: string;
  fechaBloqueo: string;
}

interface ModerationTarget {
  kind: 'operational' | 'passenger';
  messageId: string;
  senderId?: number;
  senderName: string;
  conversationId?: string;
}

export interface ChatOpenTarget {
  mode: 'general' | 'private' | 'passengers';
  channelId?: number;
  conversationId?: string;
  requestId: number;
}

const mergeMessages = (current: ChatMessage[], incoming: ChatMessage[]) => {
  const merged = new Map<string, ChatMessage>();
  current.forEach((message) => merged.set(message.idMensaje, message));
  incoming.forEach((message) => merged.set(message.idMensaje, message));
  return Array.from(merged.values()).sort(
    (left, right) => new Date(left.fechaHora).getTime() - new Date(right.fechaHora).getTime(),
  );
};

export const ChatScreen: React.FC<{
  user: UserSession;
  vehicleMoving?: boolean;
  openTarget?: ChatOpenTarget | null;
}> = ({ user, vehicleMoving = false, openTarget = null }) => {
  const { colors } = useAppTheme();
  const { showToast } = useToast();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 370;
  const styles = useMemo(() => createStyles(colors, compact), [colors, compact]);
  const isPilot = user.tipoRol === 'Piloto';
  const isReadOnly = user.tipoRol === 'Supervisor';
  const [mode, setMode] = useState<'general' | 'private' | 'passengers'>('general');
  const [pilots, setPilots] = useState<PilotItem[]>([]);
  const [selectedPilotId, setSelectedPilotId] = useState(user.idUsuario);
  const [selectedPilotName, setSelectedPilotName] = useState(user.nombreCompleto);
  const [passengerConversations, setPassengerConversations] = useState<PassengerConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const channelId = mode === 'general' ? 0 : isPilot ? user.idUsuario : selectedPilotId;
  const threadKey = mode === 'passengers' ? `passenger:${selectedConversationId}` : `channel:${channelId}`;
  const [threadMessages, setThreadMessages] = useState<Record<string, ChatMessage[]>>({});
  const [passengerThreads, setPassengerThreads] = useState<Record<string, PassengerMessage[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const messages = threadMessages[threadKey] ?? [];
  const passengerMessages = passengerThreads[threadKey] ?? [];
  const input = drafts[threadKey] ?? '';
  const setInput = useCallback((value: React.SetStateAction<string>) => setDrafts(previous => ({ ...previous,
    [threadKey]: typeof value === 'function' ? value(previous[threadKey] ?? '') : value })), [threadKey]);
  const setMessages = useCallback((value: React.SetStateAction<ChatMessage[]>) => setThreadMessages(previous => ({ ...previous,
    [threadKey]: typeof value === 'function' ? value(previous[threadKey] ?? []) : value })), [threadKey]);
  const setPassengerMessages = useCallback((value: React.SetStateAction<PassengerMessage[]>) => setPassengerThreads(previous => ({ ...previous,
    [threadKey]: typeof value === 'function' ? value(previous[threadKey] ?? []) : value })), [threadKey]);
  const requests = useRef(new Map<string, number>());
  const eventRevision = useRef(0);
  const sendIds = useRef(new Map<string, { content: string; id: string }>());
  const nearBottom = useRef(true);
  const [newMessages, setNewMessages] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [connected, setConnected] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [moderationTarget, setModerationTarget] = useState<ModerationTarget | null>(null);
  const [moderationBusy, setModerationBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const selectedPassengerConversation = passengerConversations.find((item) => item.idConversacion === selectedConversationId);
  const passengerComposerDisabled = isReadOnly || (mode === 'passengers' && (!selectedConversationId || selectedPassengerConversation?.bloqueada));
  const visibleMessages = useMemo(
    () => messages.filter((message) => !blockedUsers.some((blocked) => blocked.idUsuario === message.idEmisor)),
    [blockedUsers, messages],
  );

  useEffect(() => {
    if (!openTarget) return;
    setMode(openTarget.mode);
    if (openTarget.mode === 'private' && openTarget.channelId && openTarget.channelId > 0) {
      setSelectedPilotId(openTarget.channelId);
      const targetPilot = pilots.find((pilot) => pilot.idUsuario === openTarget.channelId);
      if (targetPilot) setSelectedPilotName(targetPilot.nombreCompleto);
    }
    if (openTarget.mode === 'passengers' && openTarget.conversationId) {
      setSelectedConversationId(openTarget.conversationId);
    }
  }, [openTarget?.requestId, pilots]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (event: KeyboardEvent) => {
      setKeyboardVisible(true);
      if (Platform.OS === 'ios') {
        setKeyboardInset(Math.max(0, event.endCoordinates.height - insets.bottom));
      }
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    };
    const onHide = () => {
      setKeyboardVisible(false);
      setKeyboardInset(0);
    };
    const showSubscription = Keyboard.addListener(showEvent, onShow);
    const hideSubscription = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [insets.bottom]);

  const fetchPassengerConversations = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await api.get<PassengerConversation[]>('/conversaciones-pasajeros');
      const list = Array.isArray(response.data) ? response.data : [];
      setPassengerConversations(list);
      setSelectedConversationId((current) => current && list.some((item) => item.idConversacion === current)
        ? current
        : list[0]?.idConversacion ?? null);
    } catch {
      if (!silent) showToast('No se pudieron cargar las consultas de pasajeros.', 'error', 'Mensajería');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showToast]);

  const fetchBlockedUsers = useCallback(async () => {
    try {
      const response = await api.get<BlockedUser[]>('/chat/bloqueos');
      setBlockedUsers(Array.isArray(response.data) ? response.data : []);
    } catch {
      setBlockedUsers([]);
    }
  }, []);

  useEffect(() => {
    void fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  useEffect(() => {
    if (isPilot) return;
    api.get<PilotItem[]>('/usuarios')
      .then((response) => {
        const list = (response.data || []).filter((item) => item.tipoRol === 'Piloto' && item.estado !== 'Inactivo');
        setPilots(list);
        const selectedPilot = list.find((item) => item.idUsuario === selectedPilotId);
        if (selectedPilot) setSelectedPilotName(selectedPilot.nombreCompleto);
        if (list.length > 0 && !list.some((item) => item.idUsuario === selectedPilotId)) {
          setSelectedPilotId(list[0].idUsuario);
          setSelectedPilotName(list[0].nombreCompleto);
        }
      })
      .catch(() => setPilots([]));
  }, [isPilot, selectedPilotId]);

  const fetchMessages = useCallback(async (silent = false, before?: string) => {
    const request = (requests.current.get(threadKey) ?? 0) + 1;
    requests.current.set(threadKey, request);
    const revision = eventRevision.current;
    const owns = () => requests.current.get(threadKey) === request && eventRevision.current === revision;
    try {
      if (!silent) setLoading(true);
      if (mode === 'passengers') {
        if (!selectedConversationId) {
          setPassengerMessages([]);
          return;
        }
        const response = await api.get<PassengerMessage[]>(`/conversaciones-pasajeros/${selectedConversationId}/mensajes`, { params: { antes: before } });
        if (owns()) setPassengerMessages(current => [...new Map([...current, ...(Array.isArray(response.data) ? response.data : [])].map(item => [item.idMensaje, item])).values()]
          .sort((a, b) => Date.parse(a.fechaHora) - Date.parse(b.fechaHora)));
        return;
      }
      const response = await api.get<ChatMessage[]>(channelId === 0 ? '/chat/general' : `/chat/canal/${channelId}`);
      const received = Array.isArray(response.data) ? response.data : [];
      // El historial persistido es la fuente de verdad y también recupera borrados/limpiezas
      // que pudieron ocurrir mientras el teléfono estaba sin conexión.
      if (owns()) setMessages(received);
    } catch {
      if (!silent) showToast('No se pudo cargar el canal.', 'error', 'Chat operativo');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [channelId, mode, selectedConversationId, showToast, threadKey, setMessages, setPassengerMessages]);

  useEffect(() => {
    if (mode !== 'passengers') return;
    void fetchPassengerConversations();
    const timer = setInterval(() => void fetchPassengerConversations(true), 8_000);
    return () => clearInterval(timer);
  }, [fetchPassengerConversations, mode]);

  useEffect(() => {
    setMessages([]);
    setPassengerMessages([]);
    nearBottom.current = true;
    setNewMessages(false);
    void fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let syncTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectAttempt = 0;
    let active = true;

    const scheduleReconnect = () => {
      if (!active || reconnectTimer) return;
      const baseDelay = Math.min(30_000, 1_500 * (2 ** reconnectAttempt));
      const delay = baseDelay + Math.round(Math.random() * 500);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (!active || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      try {
        const customUrl = await AsyncStorage.getItem('@custom_api_url');
        const apiBase = customUrl || api.defaults.baseURL || 'https://transporteseunice.com/api';
        const wsUrl = buildWebSocketUrl(apiBase);
        const token = await getAuthToken();
        if (!active) return;
        const nextSocket: WebSocket = new (WebSocket as any)(
          wsUrl,
          null,
          Platform.OS === 'web' || !token ? undefined : { headers: { Authorization: `Bearer ${token}` } },
        );
        socket = nextSocket;

        nextSocket.onopen = () => {
          reconnectAttempt = 0;
          setConnected(true);
          void fetchMessages(true);
        };
        nextSocket.onmessage = (event) => {
          if (!active) return;
          try {
            const payload = JSON.parse(event.data);
            if (payload.tipoMensaje === 'chat' && payload.data) {
              const message = payload.data as ChatMessage;
              if (message.idPilotoCanal === channelId) {
                eventRevision.current++;
                setMessages((current) => mergeMessages(current, [message]));
              }
            } else if (payload.tipoMensaje === 'mensaje_pasajero' && payload.data) {
              const message = payload.data as PassengerMessage;
              void fetchPassengerConversations(true);
              if (message.idConversacion === selectedConversationId) {
                eventRevision.current++;
                setPassengerMessages((current) => current.some((item) => item.idMensaje === message.idMensaje)
                  ? current
                  : [...current, message].sort((left, right) => new Date(left.fechaHora).getTime() - new Date(right.fechaHora).getTime()));
              }
            } else if (payload.tipoMensaje === 'chat_delete' && payload.idMensaje) {
              eventRevision.current++;
              setMessages((current) => current.filter((message) => message.idMensaje !== payload.idMensaje));
            } else if (payload.tipoMensaje === 'chat_clear') {
              const clearedChannel = payload.idPilotoCanal ?? payload.data?.idPilotoCanal;
              if (clearedChannel === -1 || clearedChannel === channelId) { eventRevision.current++; setMessages([]); }
            }
          } catch {
            // Una trama inválida no debe cerrar el canal.
          }
        };
        nextSocket.onerror = () => {
          setConnected(false);
          nextSocket.close();
        };
        nextSocket.onclose = () => {
          if (socket === nextSocket) socket = null;
          setConnected(false);
          scheduleReconnect();
        };
      } catch {
        setConnected(false);
        scheduleReconnect();
      }
    };

    const recoverConnection = () => {
      reconnectAttempt = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      void fetchMessages(true);
      void connect();
    };

    void connect();
    heartbeatTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ tipo: 'ping' }));
      }
    }, 20_000);
    syncTimer = setInterval(() => void fetchMessages(true), 8_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') recoverConnection();
    });
    const unsubscribeNetwork = NetInfo.addEventListener((state) => {
      if (state.isConnected) recoverConnection();
    });

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (syncTimer) clearInterval(syncTimer);
      appStateSubscription.remove();
      unsubscribeNetwork();
      socket?.close();
    };
  }, [channelId, fetchMessages, fetchPassengerConversations, selectedConversationId]);

  const latestMessageId = (mode === 'passengers' ? passengerMessages : messages).at(-1)?.idMensaje ?? '';
  const previousLatest = useRef('');
  useEffect(() => {
    const latest = `${threadKey}:${latestMessageId}`;
    const changed = previousLatest.current !== latest;
    previousLatest.current = latest;
    if (!nearBottom.current) { if (changed) setNewMessages(true); return; }
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [threadKey, latestMessageId]);

  const sendMessage = async (suggested?: string) => {
    const content = (suggested ?? input).trim();
    if (!content || sending || passengerComposerDisabled || isReadOnly) return;
    const pending = sendIds.current.get(threadKey);
    const id = pending?.content === content ? pending.id : newMessageId();
    sendIds.current.set(threadKey, { content, id });
    nearBottom.current = true;
    setNewMessages(false);
    try {
      setSending(true);
      if (!suggested) setInput('');
      if (mode === 'passengers') {
        if (!selectedConversationId) return;
        const response = await api.post<PassengerMessage>(`/conversaciones-pasajeros/${selectedConversationId}/mensajes`, {
          idCliente: id,
          contenido: content,
          respuestaRapida: Boolean(suggested),
        });
        setPassengerMessages((current) => current.some((item) => item.idMensaje === response.data.idMensaje)
          ? current
          : [...current, response.data]);
        void fetchPassengerConversations(true);
        sendIds.current.delete(threadKey);
        eventRevision.current++;
        return;
      }
      const response = await api.post<ChatMessage>('/chat', {
        idCliente: id,
        idPilotoCanal: channelId,
        nombrePilotoCanal: channelId === 0 ? 'Canal General de la Flota' : isPilot ? user.nombreCompleto : selectedPilotName,
        contenido: content,
        tipoContenido: suggested ? 'indicacion' : 'texto',
      });
      setMessages((current) => current.some((item) => item.idMensaje === response.data.idMensaje) ? current : [...current, response.data]);
      sendIds.current.delete(threadKey);
      eventRevision.current++;
    } catch (error: any) {
      if (!suggested) setInput(current => current || content);
      showToast(error?.response?.data?.mensaje || 'No se confirmó el envío. Conservamos el texto para reintentar.', 'error', 'Chat operativo');
    } finally {
      setSending(false);
    }
  };

  const acknowledgeLoaded = async () => {
    if (isReadOnly || !selectedConversationId || acknowledging) return;
    const conversationId = selectedConversationId;
    const ids = passengerMessages.map(message => message.idMensaje);
    setAcknowledging(true);
    try {
      for (let offset = 0; offset < ids.length; offset += 200)
        await api.post(`/conversaciones-pasajeros/${conversationId}/leido`, { idsMensaje: ids.slice(offset, offset + 200) });
      await fetchPassengerConversations(true);
    } catch { showToast('No se confirmó toda la lectura. Puedes volver a intentarlo.', 'error', 'Lectura del equipo'); }
    finally { setAcknowledging(false); }
  };

  const reportMessage = async () => {
    if (!moderationTarget || moderationBusy) return;
    try {
      setModerationBusy(true);
      const endpoint = moderationTarget.kind === 'passenger'
        ? `/conversaciones-pasajeros/${moderationTarget.conversationId}/mensajes/${moderationTarget.messageId}/reportes`
        : `/chat/${moderationTarget.messageId}/reportes`;
      await api.post(endpoint, { motivo: 'Contenido ofensivo o inapropiado' });
      setModerationTarget(null);
      showToast('El mensaje fue enviado a revisión.', 'success', 'Denuncia recibida');
    } catch (error: any) {
      showToast(error?.response?.data?.mensaje || 'No se pudo enviar la denuncia.', 'error', 'Moderación');
    } finally {
      setModerationBusy(false);
    }
  };

  const blockModerationTarget = async () => {
    if (!moderationTarget || moderationBusy) return;
    try {
      setModerationBusy(true);
      if (moderationTarget.kind === 'passenger') {
        if (!moderationTarget.conversationId) return;
        await api.post(`/conversaciones-pasajeros/${moderationTarget.conversationId}/bloqueo?bloqueada=true`);
        setPassengerConversations((current) => current.map((conversation) => (
          conversation.idConversacion === moderationTarget.conversationId
            ? { ...conversation, bloqueada: true }
            : conversation
        )));
        showToast('El pasajero ya no puede enviar mensajes en este viaje.', 'success', 'Conversación bloqueada');
      } else {
        if (!moderationTarget.senderId) return;
        await api.post(`/chat/usuarios/${moderationTarget.senderId}/bloqueo?bloqueado=true`);
        await fetchBlockedUsers();
        showToast(`Ya no verás mensajes de ${moderationTarget.senderName}.`, 'success', 'Usuario bloqueado');
      }
      setModerationTarget(null);
    } catch (error: any) {
      showToast(error?.response?.data?.mensaje || 'No se pudo bloquear al remitente.', 'error', 'Moderación');
    } finally {
      setModerationBusy(false);
    }
  };

  const unblockUser = async (blockedUser: BlockedUser) => {
    try {
      await api.post(`/chat/usuarios/${blockedUser.idUsuario}/bloqueo?bloqueado=false`);
      setBlockedUsers((current) => current.filter((item) => item.idUsuario !== blockedUser.idUsuario));
      void fetchMessages(true);
      showToast(`Volverás a ver mensajes de ${blockedUser.nombreCompleto}.`, 'success', 'Usuario habilitado');
    } catch (error: any) {
      showToast(error?.response?.data?.mensaje || 'No se pudo habilitar al usuario.', 'error', 'Moderación');
    }
  };

  const setPassengerBlocked = async (blocked: boolean) => {
    if (!selectedConversationId || moderationBusy || isReadOnly) return;
    try {
      setModerationBusy(true);
      await api.post(`/conversaciones-pasajeros/${selectedConversationId}/bloqueo?bloqueada=${blocked}`);
      setPassengerConversations((current) => current.map((conversation) => (
        conversation.idConversacion === selectedConversationId
          ? { ...conversation, bloqueada: blocked }
          : conversation
      )));
      showToast(
        blocked ? 'El pasajero ya no puede enviar mensajes.' : 'El pasajero puede volver a escribir.',
        'success',
        blocked ? 'Conversación bloqueada' : 'Conversación habilitada',
      );
    } catch (error: any) {
      showToast(error?.response?.data?.mensaje || 'No se pudo actualizar la conversación.', 'error', 'Moderación');
    } finally {
      setModerationBusy(false);
    }
  };

  const suggestions = mode === 'passengers'
    ? ['Estamos en ruta.', 'Llegaremos en breve.', 'Consulta recibida por el conductor.']
    : mode === 'general'
    ? isPilot
      ? ['Tráfico pesado en el tramo actual.', 'Realizando una parada breve.', 'Unidad en ruta sin novedades.']
      : ['Mantener velocidad moderada.', 'Precaución por lluvia en ruta.', 'Confirmar recepción del aviso.']
    : isPilot
      ? ['Solicito indicaciones de despacho.', 'Reporto una parada no programada.', 'Recorrido iniciado sin novedades.']
      : ['Reduce velocidad en el siguiente tramo.', 'Confirma tu ubicación actual.', 'Reporte recibido por despacho.'];

  return (
    <KeyboardAvoidingView
      style={[styles.screen, Platform.OS === 'ios' && keyboardInset > 0 ? { paddingBottom: keyboardInset + 8 } : null]}
      behavior={Platform.OS === 'android' ? 'height' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{mode === 'general' ? 'Canal general' : mode === 'private' ? 'Piloto y despacho' : 'Pasajeros'}</Text>
          <View style={styles.connectionRow}><View style={[styles.connectionDot, { backgroundColor: connected ? colors.success : colors.warning }]} /><Text style={styles.subtitle}>{connected ? 'Actualización en tiempo real' : 'Reconectando canal'}</Text></View>
        </View>
        <View style={styles.modeSwitch}>
          <ModeButton label="Canal general" styles={styles} colors={colors} active={mode === 'general'} icon="radio" onPress={() => setMode('general')} />
          <ModeButton label="Piloto y despacho, visible para administración y supervisión" styles={styles} colors={colors} active={mode === 'private'} icon="lock" onPress={() => setMode('private')} />
          <ModeButton label="Conversaciones de pasajeros" styles={styles} colors={colors} active={mode === 'passengers'} icon="users" onPress={() => setMode('passengers')} />
        </View>
      </View>

      {mode === 'private' && <Text style={styles.subtitle}>Visible para el piloto, administración y supervisión.</Text>}
      {isReadOnly && (
        <View style={styles.readOnlyNotice}>
          <Feather name="eye" size={15} color={colors.focus} />
          <Text style={styles.readOnlyText}>Modo auditoría: puedes consultar los canales, pero no enviar mensajes.</Text>
        </View>
      )}

      {blockedUsers.length > 0 && mode !== 'passengers' && (
        <View style={styles.blockedStrip}>
          <View style={styles.blockedStripTitle}>
            <Feather name="shield" size={14} color={colors.warning} />
            <Text style={styles.blockedStripText}>Bloqueados</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blockedUsers}>
            {blockedUsers.map((blockedUser) => (
              <Pressable key={blockedUser.idUsuario} style={styles.blockedChip} onPress={() => void unblockUser(blockedUser)}>
                <Text style={styles.blockedChipText}>{blockedUser.nombreCompleto}</Text>
                <Feather name="x" size={13} color={colors.warning} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {!isPilot && mode === 'private' && (
        <View style={styles.pilotStrip}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pilotStripContent}>
            {pilots.map((pilot) => (
              <Pressable key={pilot.idUsuario} style={[styles.pilotChip, selectedPilotId === pilot.idUsuario && styles.pilotChipActive]} onPress={() => { setSelectedPilotId(pilot.idUsuario); setSelectedPilotName(pilot.nombreCompleto); }}>
                <View style={styles.pilotAvatar}><Text style={styles.pilotAvatarText}>{pilot.nombreCompleto.charAt(0)}</Text></View>
                <Text style={[styles.pilotChipText, selectedPilotId === pilot.idUsuario && styles.pilotChipTextActive]}>{pilot.nombreCompleto}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {mode === 'passengers' && passengerConversations.length > 0 && (
        <View style={styles.pilotStrip}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pilotStripContent}>
            {passengerConversations.map((conversation) => (
              <Pressable key={conversation.idConversacion} style={[styles.passengerChip, selectedConversationId === conversation.idConversacion && styles.pilotChipActive]} onPress={() => setSelectedConversationId(conversation.idConversacion)}>
                <View style={styles.passengerChipTop}>
                  <Text style={[styles.pilotChipText, selectedConversationId === conversation.idConversacion && styles.pilotChipTextActive]}>{conversation.aliasPasajero}</Text>
                  {conversation.noLeidos > 0 && <View style={styles.unreadBadge}><Text style={styles.unreadText}>{conversation.noLeidos}</Text></View>}
                </View>
                <Text style={styles.passengerMeta} numberOfLines={1}>{conversation.unidad} · {conversation.nombreRuta}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}


      {mode === 'passengers' && selectedPassengerConversation && !isReadOnly && (
        <Pressable
          style={[styles.passengerSafetyButton, selectedPassengerConversation.bloqueada && styles.passengerSafetyButtonBlocked]}
          disabled={moderationBusy}
          onPress={() => void setPassengerBlocked(!selectedPassengerConversation.bloqueada)}
        >
          <Feather name={selectedPassengerConversation.bloqueada ? 'unlock' : 'slash'} size={14} color={selectedPassengerConversation.bloqueada ? colors.success : colors.danger} />
          <Text style={[styles.passengerSafetyText, { color: selectedPassengerConversation.bloqueada ? colors.success : colors.danger }]}>
            {selectedPassengerConversation.bloqueada ? 'Habilitar mensajes del pasajero' : 'Bloquear mensajes del pasajero'}
          </Text>
        </Pressable>
      )}

      <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        scrollEventThrottle={100} onScroll={event => { const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
          nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 90;
          if (nearBottom.current) setNewMessages(false);
        }}>
        {mode === 'passengers' && passengerMessages.length > 0 && <View style={{ gap: 8 }}>
          <Pressable accessibilityRole="button" style={styles.suggestion} onPress={() => { nearBottom.current = false; void fetchMessages(false, passengerMessages[0]?.idMensaje); }}><Text style={styles.suggestionText}>Cargar mensajes anteriores</Text></Pressable>
          {!isReadOnly && <Pressable accessibilityRole="button" disabled={acknowledging || !passengerMessages.length} style={styles.suggestion} onPress={() => void acknowledgeLoaded()}><Text style={styles.suggestionText}>{acknowledging ? 'Confirmando lectura…' : `Marcar ${passengerMessages.length} mensajes cargados como leídos · equipo`}</Text></Pressable>}
        </View>}
        {loading ? (
          <ActivityIndicator color={colors.accent} style={styles.loader} />
        ) : mode === 'passengers' && passengerConversations.length === 0 ? (
          <View style={styles.emptyChat}><View style={styles.emptyIcon}><Feather name="users" size={24} color={colors.subtle} /></View><Text style={styles.emptyTitle}>Sin consultas de pasajeros</Text><Text style={styles.emptyText}>Las conversaciones del enlace público aparecerán aquí.</Text></View>
        ) : (mode === 'passengers' ? passengerMessages : visibleMessages).length === 0 ? (
          <View style={styles.emptyChat}><View style={styles.emptyIcon}><Feather name="message-square" size={24} color={colors.subtle} /></View><Text style={styles.emptyTitle}>Sin mensajes todavía</Text><Text style={styles.emptyText}>Inicia la conversación o utiliza una respuesta rápida.</Text></View>
        ) : (mode === 'passengers' ? passengerMessages : visibleMessages).map((rawMessage) => {
          const passengerMessage = mode === 'passengers' ? rawMessage as PassengerMessage : null;
          const chatMessage = mode !== 'passengers' ? rawMessage as ChatMessage : null;
          const mine = passengerMessage ? passengerMessage.idUsuarioEmisor === user.idUsuario : chatMessage!.idEmisor === user.idUsuario;
          const messageId = passengerMessage?.idMensaje ?? chatMessage!.idMensaje;
          const sender = passengerMessage?.nombreEmisor ?? chatMessage!.nombreEmisor;
          const content = passengerMessage?.contenido ?? chatMessage!.contenido;
          const timestamp = passengerMessage?.fechaHora ?? chatMessage!.fechaHora;
          return (
            <View key={messageId} style={[styles.messageRow, mine && styles.messageRowMine]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                {!mine && (
                  <View style={styles.senderRow}>
                    <Text style={styles.sender}>{sender}</Text>
                    {!isReadOnly && (!passengerMessage || passengerMessage.tipoEmisor === 'Pasajero') && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Opciones del mensaje de ${sender}`}
                        hitSlop={12}
                        style={styles.messageMenu}
                        onPress={() => setModerationTarget({
                          kind: passengerMessage ? 'passenger' : 'operational',
                          messageId,
                          senderId: chatMessage?.idEmisor,
                          senderName: sender,
                          conversationId: passengerMessage?.idConversacion,
                        })}
                      >
                        <Feather name="more-horizontal" size={16} color={colors.muted} />
                      </Pressable>
                    )}
                  </View>
                )}
                <Text style={[styles.messageText, mine && styles.messageTextMine]}>{content}</Text>
                <Text style={[styles.messageTime, mine && styles.messageTimeMine]}>{new Date(timestamp).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {newMessages && <Pressable accessibilityRole="button" style={styles.suggestion} onPress={() => {
        nearBottom.current = true; setNewMessages(false); scrollRef.current?.scrollToEnd({ animated: false });
      }}><Text style={styles.suggestionText}>Ir a los mensajes recientes</Text></Pressable>}
      <View style={styles.composerArea}>
        {!keyboardVisible && (
          <ScrollView style={styles.suggestionsScroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestions} keyboardShouldPersistTaps="handled">
            {suggestions.map((suggestion) => <Pressable key={suggestion} style={[styles.suggestion, (passengerComposerDisabled || isReadOnly) && styles.suggestionDisabled]} onPress={() => void sendMessage(suggestion)} disabled={passengerComposerDisabled || isReadOnly}><Text style={styles.suggestionText}>{suggestion}</Text></Pressable>)}
          </ScrollView>
        )}
        <View style={styles.composer}>
          <TextInput value={input} onChangeText={setInput} style={styles.input} placeholder={isReadOnly ? 'Canal disponible en modo lectura' : passengerComposerDisabled ? 'Selecciona una conversación disponible' : mode === 'passengers' && isPilot && vehicleMoving ? 'Usa una respuesta rápida mientras conduces' : mode === 'passengers' ? 'Responder al pasajero' : 'Escribe un mensaje operativo'} placeholderTextColor={colors.subtle} multiline maxLength={mode === 'passengers' ? 500 : 800} editable={!isReadOnly && !passengerComposerDisabled && !(mode === 'passengers' && isPilot && vehicleMoving)} onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)} blurOnSubmit={false} />
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar mensaje" accessibilityState={{ disabled: !input.trim() || sending || passengerComposerDisabled || isReadOnly }} style={[styles.sendButton, (!input.trim() || sending || passengerComposerDisabled || isReadOnly || (mode === 'passengers' && isPilot && vehicleMoving)) && styles.sendButtonDisabled]} onPress={() => void sendMessage()} disabled={!input.trim() || sending || passengerComposerDisabled || isReadOnly || (mode === 'passengers' && isPilot && vehicleMoving)}>
            {sending ? <ActivityIndicator size="small" color={colors.white} /> : <Feather name="send" size={18} color={colors.white} />}
          </Pressable>
        </View>
      </View>

      <Modal visible={Boolean(moderationTarget)} transparent animationType="fade" onRequestClose={() => !moderationBusy && setModerationTarget(null)}>
        <View style={styles.moderationLayer}>
          <Pressable style={styles.moderationBackdrop} onPress={() => !moderationBusy && setModerationTarget(null)} />
          <View style={styles.moderationCard}>
            <View style={styles.moderationIcon}><Feather name="shield" size={21} color={colors.accent} /></View>
            <Text style={styles.moderationTitle}>Seguridad del chat</Text>
            <Text style={styles.moderationCopy}>Elige qué hacer con el mensaje de {moderationTarget?.senderName}.</Text>
            <Pressable style={styles.moderationAction} disabled={moderationBusy} onPress={() => void reportMessage()}>
              <Feather name="flag" size={17} color={colors.warning} />
              <View style={styles.moderationActionCopy}>
                <Text style={styles.moderationActionTitle}>Denunciar mensaje</Text>
                <Text style={styles.moderationActionText}>Envía el contenido a revisión administrativa.</Text>
              </View>
            </Pressable>
            <Pressable style={styles.moderationAction} disabled={moderationBusy} onPress={() => void blockModerationTarget()}>
              <Feather name="slash" size={17} color={colors.danger} />
              <View style={styles.moderationActionCopy}>
                <Text style={styles.moderationActionTitle}>Bloquear remitente</Text>
                <Text style={styles.moderationActionText}>Oculta sus mensajes y evita nuevos contactos.</Text>
              </View>
            </Pressable>
            <Pressable style={styles.moderationCancel} disabled={moderationBusy} onPress={() => setModerationTarget(null)}>
              {moderationBusy ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.moderationCancelText}>Cancelar</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const ModeButton = ({ label, styles, colors, active, icon, onPress }: { label: string; styles: ReturnType<typeof createStyles>; colors: AppColors; active: boolean; icon: React.ComponentProps<typeof Feather>['name']; onPress: () => void }) => (
  <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }} style={[styles.modeButton, active && styles.modeButtonActive]} onPress={onPress}><Feather name={icon} size={18} color={active ? colors.white : colors.muted} /></Pressable>
);

const createStyles = (colors: AppColors, compact = false) => StyleSheet.create({
  screen: { flex: 1, minHeight: 0, backgroundColor: colors.canvas, padding: compact ? 8 : 12, gap: compact ? 8 : 10 },
  header: { minHeight: 66, borderRadius: 18, paddingHorizontal: compact ? 12 : 15, paddingVertical: compact ? 10 : 0, flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'center', gap: compact ? 9 : 0, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  headerCopy: { flex: 1 },
  title: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  connectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  connectionDot: { width: 7, height: 7, borderRadius: 4 },
  subtitle: { color: colors.muted, fontSize: 10 },
  modeSwitch: { flexDirection: 'row', alignSelf: compact ? 'stretch' : 'auto', padding: 3, borderRadius: 12, backgroundColor: colors.surfaceRaised, gap: 3 },
  modeButton: { flex: compact ? 1 : undefined, minWidth: 48, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modeButtonActive: { backgroundColor: colors.accent },
  readOnlyNotice: { minHeight: 42, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.lineStrong },
  readOnlyText: { flex: 1, color: colors.focus, fontSize: 10.5, fontWeight: '700', lineHeight: 15 },
  blockedStrip: { minHeight: 45, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.warning },
  blockedStripTitle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  blockedStripText: { color: colors.warning, fontSize: 9.5, fontWeight: '900' },
  blockedUsers: { gap: 6, paddingRight: 6 },
  blockedChip: { minHeight: 29, borderRadius: 10, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.surface },
  blockedChipText: { color: colors.ink, fontSize: 9, fontWeight: '800' },
  pilotStrip: { minHeight: 52 },
  pilotStripContent: { gap: 7, paddingHorizontal: 2 },
  pilotChip: { minHeight: 48, borderRadius: 13, paddingHorizontal: 8, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  pilotChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pilotAvatar: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  pilotAvatarText: { color: colors.accent, fontSize: 11, fontWeight: '900' },
  pilotChipText: { color: colors.muted, fontSize: 10.5, fontWeight: '700' },
  pilotChipTextActive: { color: colors.accent, fontWeight: '900' },
  passengerChip: { width: 190, minHeight: 50, borderRadius: 13, paddingHorizontal: 11, paddingVertical: 8, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  passengerChipTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 7 },
  passengerMeta: { color: colors.subtle, fontSize: 9, marginTop: 4 },
  unreadBadge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  unreadText: { color: colors.white, fontSize: 9, fontWeight: '900' },
  passengerSafetyButton: { minHeight: 38, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger },
  passengerSafetyButtonBlocked: { backgroundColor: colors.successSoft, borderColor: colors.success },
  passengerSafetyText: { fontSize: 10, fontWeight: '900' },
  messages: { flex: 1, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  messagesContent: { flexGrow: 1, padding: compact ? 10 : 14, justifyContent: 'flex-end' },
  loader: { marginVertical: 30 },
  emptyChat: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 50, height: 50, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  emptyTitle: { color: colors.ink, fontSize: 14, fontWeight: '900', marginTop: 12 },
  emptyText: { color: colors.muted, fontSize: 11, marginTop: 4 },
  messageRow: { alignItems: 'flex-start', marginBottom: 9 },
  messageRowMine: { alignItems: 'flex-end' },
  bubble: { maxWidth: compact ? '90%' : '84%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleOther: { backgroundColor: colors.surfaceRaised, borderBottomLeftRadius: 5 },
  bubbleMine: { backgroundColor: colors.accent, borderBottomRightRadius: 5 },
  sender: { color: colors.accent, fontSize: 9.5, fontWeight: '900', marginBottom: 4 },
  senderRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  messageMenu: { width: 28, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  messageText: { color: colors.ink, fontSize: 12, lineHeight: 17 },
  messageTextMine: { color: colors.white },
  messageTime: { color: colors.subtle, fontSize: 8.5, marginTop: 5, textAlign: 'right' },
  messageTimeMine: { color: '#ffffffaa' },
  composerArea: { gap: 8 },
  suggestionsScroll: { flexGrow: 0, maxWidth: '100%' },
  suggestions: { gap: 7, paddingHorizontal: 1, paddingRight: 14 },
  suggestion: { minHeight: 34, borderRadius: 11, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  suggestionDisabled: { opacity: 0.45 },
  suggestionText: { color: colors.muted, fontSize: 9.5, fontWeight: '700' },
  composer: { minHeight: 54, minWidth: 0, borderRadius: 17, padding: 5, paddingLeft: 13, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong },
  input: { flex: 1, minWidth: 0, maxHeight: 92, minHeight: 42, color: colors.ink, fontSize: 12, paddingTop: 11, paddingBottom: 10 },
  sendButton: { width: 48, height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  sendButtonDisabled: { opacity: 0.45 },
  moderationLayer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  moderationBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim },
  moderationCard: { width: '100%', maxWidth: 410, borderRadius: 22, padding: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong },
  moderationIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  moderationTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: 14 },
  moderationCopy: { color: colors.muted, fontSize: 11.5, lineHeight: 17, marginTop: 5, marginBottom: 14 },
  moderationAction: { minHeight: 62, borderRadius: 15, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line, marginBottom: 8 },
  moderationActionCopy: { flex: 1 },
  moderationActionTitle: { color: colors.ink, fontSize: 11.5, fontWeight: '900' },
  moderationActionText: { color: colors.muted, fontSize: 9.5, lineHeight: 14, marginTop: 2 },
  moderationCancel: { minHeight: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 5, backgroundColor: colors.surfaceSoft },
  moderationCancelText: { color: colors.ink, fontSize: 11, fontWeight: '900' },
});
