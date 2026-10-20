import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import api from '../api/client';
import { ResourceNotice } from '../components/ResourceNotice';
import { useToast } from '../context/ToastContext';
import { useAppTheme, type AppColors } from '../theme/AppTheme';
import { AppTextField, ChoiceChip, EmptyState, PrimaryButton, ScreenHeader, ScreenScroll, SurfaceCard, uiStyles } from '../components/MobileUI';

interface UserItem {
  version?: string;
  idUsuario: number;
  usuarioLogin: string;
  nombreCompleto: string;
  tipoRol: 'Piloto' | 'Administrador' | 'Supervisor';
  estado: string;
}

export const UsersScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const { showToast } = useToast();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const common = useMemo(() => uiStyles(colors), [colors]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserItem['tipoRol']>('Piloto');
  const [accountState, setAccountState] = useState('Activo');
  const [editingVersion, setEditingVersion] = useState<string>();

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await api.get<UserItem[]>('/usuarios');
      setUsers(Array.isArray(response.data) ? response.data : []);
      setLoadError(false); setUpdatedAt(Date.now());
    } catch {
      setLoadError(true);
      showToast('No se pudo consultar el personal.', 'error', 'Conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchUsers(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setUsername('');
    setFullName('');
    setPassword('');
    setRole('Piloto');
    setAccountState('Activo');
    setEditingVersion(undefined);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const editUser = (item: UserItem) => {
    setEditingId(item.idUsuario);
    setUsername(item.usuarioLogin);
    setFullName(item.nombreCompleto);
    setPassword('');
    setRole(item.tipoRol);
    setAccountState(item.estado);
    setEditingVersion(item.version);
    setShowForm(true);
  };

  const saveUser = async () => {
    if (!username.trim() || !fullName.trim()) {
      showToast('Usuario y nombre completo son requeridos.', 'warning', 'Datos incompletos');
      return;
    }
    if (!editingId && password.length < 12) {
      showToast('La contraseña debe tener al menos 12 caracteres.', 'warning', 'Contraseña insegura');
      return;
    }

    const wasEditing = Boolean(editingId);
    try {
      setSaving(true);
      const payload = {
        usuarioLogin: username.trim(),
        nombreCompleto: fullName.trim(),
        contrasena: password || null,
        tipoRol: role,
        estado: accountState,
        version: editingVersion,
      };
      if (editingId) await api.put(`/usuarios/${editingId}`, payload);
      else await api.post('/usuarios', { ...payload, contrasena: password });
      closeForm();
      await fetchUsers();
      showToast(wasEditing ? 'Los cambios fueron guardados.' : 'El usuario quedó registrado.', 'success', 'Personal actualizado');
    } catch (error: any) {
      showToast(error.response?.data?.mensaje || 'No se pudo guardar el usuario.', 'error', 'Operación rechazada');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenScroll>
      <ResourceNotice error={loadError} updatedAt={updatedAt} onRetry={() => void fetchUsers()} />
      <ScreenHeader
        title="Personal y pilotos"
        subtitle={`${users.length} cuentas administradas`}
        action={<PrimaryButton label={showForm ? 'Cerrar' : 'Agregar'} icon={showForm ? 'x' : 'user-plus'} onPress={() => showForm ? closeForm() : setShowForm(true)} variant={showForm ? 'secondary' : 'primary'} />}
      />

      {showForm && (
        <SurfaceCard>
          <Text style={common.sectionEyebrow}>{editingId ? 'EDITAR CUENTA' : 'NUEVA CUENTA'}</Text>
          <Text style={common.sectionTitle}>{editingId ? 'Actualizar acceso' : 'Registrar personal'}</Text>
          <View style={styles.formGrid}>
            <AppTextField label="Nombre completo" value={fullName} onChangeText={setFullName} placeholder="Nombre y apellido" />
            <AppTextField label="Usuario" value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="usuario" />
            <AppTextField label={editingId ? 'Nueva contraseña (opcional)' : 'Contraseña'} value={password} onChangeText={setPassword} secureTextEntry placeholder="Mínimo 12 caracteres" />
            <View style={styles.roleField}>
              <Text style={styles.label}>Rol y permisos</Text>
              <View style={styles.roleChoices}>
                {(['Piloto', 'Supervisor', 'Administrador'] as const).map((item) => (
                  <ChoiceChip key={item} label={item} active={role === item} onPress={() => setRole(item)} icon={item === 'Piloto' ? 'navigation' : item === 'Supervisor' ? 'eye' : 'shield'} />
                ))}
              </View>
            </View>
          </View>
          <View style={styles.formActions}>
            <PrimaryButton label={saving ? 'Guardando...' : 'Guardar cuenta'} icon="save" onPress={() => void saveUser()} disabled={saving} />
          </View>
        </SurfaceCard>
      )}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : users.length === 0 && loadError ? null : users.length === 0 ? (
        <EmptyState icon="users" title="Sin personal registrado" message="Crea la primera cuenta para asignar pilotos, supervisores o administradores." />
      ) : (
        <View style={styles.list}>
          {users.map((item) => (
            <SurfaceCard key={item.idUsuario} style={styles.userCard}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{item.nombreCompleto.charAt(0).toUpperCase()}</Text></View>
              <View style={styles.userCopy}>
                <Text style={styles.userName}>{item.nombreCompleto}</Text>
                <Text style={styles.username}>@{item.usuarioLogin}</Text>
                <View style={styles.metaRow}>
                  <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{item.tipoRol}</Text></View>
                  <View style={[styles.stateDot, { backgroundColor: item.estado === 'Activo' ? colors.success : colors.subtle }]} />
                  <Text style={styles.stateText}>{item.estado}</Text>
                </View>
              </View>
              <Pressable style={styles.editButton} onPress={() => editUser(item)}>
                <Feather name="edit-2" size={16} color={colors.accent} />
              </Pressable>
            </SurfaceCard>
          ))}
        </View>
      )}
    </ScreenScroll>
  );
};

const createStyles = (colors: AppColors) => StyleSheet.create({
  formGrid: { gap: 12, marginTop: 17 },
  roleField: { gap: 7 },
  label: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  roleChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  formActions: { marginTop: 16, alignItems: 'flex-end' },
  loader: { marginTop: 36 },
  list: { gap: 10 },
  userCard: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine },
  avatarText: { color: colors.accent, fontSize: 16, fontWeight: '900' },
  userCopy: { flex: 1, minWidth: 0, marginLeft: 12 },
  userName: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  username: { color: colors.muted, fontSize: 10.5, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  roleBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.surfaceRaised },
  roleBadgeText: { color: colors.muted, fontSize: 9, fontWeight: '900' },
  stateDot: { width: 6, height: 6, borderRadius: 3 },
  stateText: { color: colors.subtle, fontSize: 9.5 },
  editButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
});
