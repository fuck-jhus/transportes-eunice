import React from 'react';
import { Text, View } from 'react-native';
import { PrimaryButton } from './MobileUI';
import { useAppTheme } from '../theme/AppTheme';

export const ResourceNotice = ({ error, updatedAt, onRetry }: { error: boolean; updatedAt: number | null; onRetry: () => void }) => {
  const { colors } = useAppTheme();
  if (!error) return null;
  return <View style={{ gap: 10, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }}>
    <Text accessibilityRole="alert" style={{ color: colors.ink }}>No se pudo actualizar la consulta. {updatedAt
      ? `Conservamos los datos consultados a las ${new Date(updatedAt).toLocaleTimeString('es-GT')}.` : 'Todavía no se ha confirmado si hay registros.'}</Text>
    <PrimaryButton label="Volver a consultar" icon="refresh-cw" variant="secondary" onPress={onRetry} />
  </View>;
};
