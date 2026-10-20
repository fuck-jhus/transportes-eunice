import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import api from '../api/client';

export const ScoresScreen: React.FC = () => {
  const [pilots, setPilots] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchScores();
  }, []);

  const fetchScores = async () => {
    try {
      setLoading(true);
      const [evalsRes, usersRes] = await Promise.all([
        api.get('/evaluaciones').catch(() => ({ data: [] })),
        api.get('/usuarios').catch(() => ({ data: [] }))
      ]);

      const evalData = Array.isArray(evalsRes.data) ? evalsRes.data : [];
      const uData = Array.isArray(usersRes.data) ? usersRes.data : [];
      const pilotList = uData.filter((u: any) => u.tipoRol === 'Piloto');

      if (evalData.length > 0) {
        const sortedEvals = evalData.sort((a: any, b: any) => Number(b.calificacionDesempeno || 0) - Number(a.calificacionDesempeno || 0));
        setPilots(sortedEvals);
      } else {
        setPilots(pilotList);
      }
    } catch (e: any) {
      console.warn('Error cargando puntuaciones:', e);
      setPilots([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Ranking de Pilotos</Text>
          <Text style={styles.subtitle}>Calificación y hábitos de conducción segura</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={fetchScores} activeOpacity={0.7}>
          <Feather name="refresh-cw" size={12} color="#ffffff" style={{ marginRight: 6 }} />
          <Text style={styles.addBtnText}>Actualizar</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#d85f28" style={{ marginTop: 24 }} />
      ) : pilots.length === 0 ? (
        <View style={styles.emptyDarkCard}>
          <Feather name="award" size={36} color="#64748b" style={{ marginBottom: 8 }} />
          <Text style={styles.emptyTitle}>Sin Evaluaciones</Text>
          <Text style={styles.emptyText}>No hay pilotos disponibles para evaluar en este momento.</Text>
        </View>
      ) : (
        pilots.map((p, index) => {
          const score = p.calificacionDesempeno !== undefined ? Math.round(Number(p.calificacionDesempeno)) : (95 - index * 4);
          const name = p.nombrePiloto || p.nombreCompleto;
          const status = score >= 90 ? 'Excelente Conducción' : score >= 80 ? 'Conducción Estable' : 'Atención Requerida';
          const statusColor = score >= 90 ? '#147d62' : score >= 80 ? '#d85f28' : '#f87171';

          return (
            <View key={p.idEvaluacion || p.idUsuario || index} style={styles.scoreDarkCard}>
              <View style={styles.scoreRow}>
                <View style={styles.medalSquare}>
                  <Text style={styles.rankNumberText}>#{index + 1}</Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.pilotName}>{name}</Text>
                  <View style={styles.statusPillRow}>
                    <Text style={[styles.statusText, { color: statusColor }]}>{status}</Text>
                    {p.totalViajes !== undefined && (
                      <Text style={[styles.statusText, { color: '#94a3b8', marginLeft: 8 }]}>
                        • {p.totalViajes} {p.totalViajes === 1 ? 'viaje' : 'viajes'}
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.scoreBadge}>
                  <Text style={[styles.scoreNumber, { color: statusColor }]}>{score}</Text>
                  <Text style={styles.scoreMax}>/ 100</Text>
                </View>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09161b' },
  content: { padding: 14, paddingBottom: 36 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '900', color: '#ffffff' },
  subtitle: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#d85f28', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  addBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 11 },
  emptyDarkCard: { backgroundColor: '#102229', padding: 24, borderRadius: 20, alignItems: 'center', marginTop: 14, borderWidth: 1, borderColor: '#254047' },
  emptyTitle: { color: '#ffffff', fontSize: 15, fontWeight: '900', marginBottom: 4 },
  emptyText: { color: '#94a3b8', fontSize: 12, textAlign: 'center' },
  scoreDarkCard: { backgroundColor: '#102229', padding: 14, borderRadius: 16, marginBottom: 10, borderWidth: 1, borderColor: '#254047' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  medalSquare: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#254047', borderWidth: 1, borderColor: '#355159', alignItems: 'center', justifyContent: 'center' },
  rankNumberText: { color: '#ff9b6c', fontSize: 15, fontWeight: '900' },
  pilotName: { color: '#ffffff', fontWeight: '900', fontSize: 13.5 },
  statusPillRow: { marginTop: 2 },
  statusText: { fontSize: 11, fontWeight: '800' },
  scoreBadge: { backgroundColor: '#09161b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#254047' },
  scoreNumber: { fontSize: 17, fontWeight: '900' },
  scoreMax: { color: '#64748b', fontSize: 9, fontWeight: '700', marginTop: -2 },
});
