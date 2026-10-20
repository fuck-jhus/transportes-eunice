import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { LEAFLET_CSS, LEAFLET_JS } from '../screens/leafletAssets';

export interface MapCoordinate {
  latitude: number;
  longitude: number;
}

export interface MapRegion extends MapCoordinate {
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface LeafletMapHandle {
  invalidateSize: () => void;
  followCoordinate: (coordinate: MapCoordinate) => void;
  animateToRegion: (region: MapRegion, duration?: number) => void;
  fitToCoordinates: (
    coordinates: MapCoordinate[],
    options?: {
      edgePadding?: { top?: number; right?: number; bottom?: number; left?: number };
      animated?: boolean;
    },
  ) => void;
}

export interface LeafletBusMarker {
  id: string;
  latitude: number;
  longitude: number;
  plate: string;
  driver: string;
  route: string;
  speedKmh: number;
  heading?: number | null;
  activeTrip?: boolean;
}

export interface LeafletRouteLine {
  id: string;
  coordinates: MapCoordinate[];
  selected: boolean;
}

interface LeafletNativeMapProps {
  style?: StyleProp<ViewStyle>;
  theme: 'dark' | 'light';
  initialRegion: MapRegion;
  userMarker?: {
    latitude: number;
    longitude: number;
    title: string;
    description: string;
    heading: number | null;
    navigating: boolean;
    following?: boolean;
    routeId?: string;
    progressMeters?: number;
    accuracyMeters?: number;
  };
  buses: LeafletBusMarker[];
  destination?: {
    latitude: number;
    longitude: number;
    title: string;
    description: string;
  };
  routes: LeafletRouteLine[];
  onBusPress?: (id: string) => void;
  onRegionChangeComplete?: (region: MapRegion) => void;
  onUserGesture?: () => void;
}

const INITIAL_CENTER = { latitude: 14.8347, longitude: -91.5181 };

const serializeForScript = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

export const createLeafletDocument = (): string => `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <style>
    ${LEAFLET_CSS}
    * { box-sizing: border-box; }
    html, body, #map {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      overscroll-behavior: none;
      touch-action: none;
      -webkit-user-select: none;
      user-select: none;
    }
    body { background: #102229; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .leaflet-container { background: #102229; touch-action: none !important; }
    .leaflet-tile { image-rendering: auto; }
    .leaflet-control-attribution {
      border-radius: 8px 0 0 0;
      font-size: 9px !important;
      line-height: 14px !important;
      padding: 1px 5px !important;
    }
    .map-dark .leaflet-control-attribution { background: rgba(10, 30, 36, .82) !important; color: #b7c7cb; }
    .map-dark .leaflet-control-attribution a { color: #d7e5e7; }
    .map-light .leaflet-control-attribution { background: rgba(255, 255, 255, .86) !important; color: #53666b; }
    .leaflet-tile-pane { transition: filter 220ms ease; }
    .map-light .leaflet-tile-pane { filter: none; }
    .map-dark .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) saturate(.68) brightness(.68) contrast(1.12); }
    .leaflet-control-zoom { border: 0 !important; box-shadow: 0 10px 28px rgba(0,0,0,.18) !important; }
    .leaflet-control-zoom a {
      width: 48px !important;
      height: 48px !important;
      line-height: 48px !important;
      border: 0 !important;
      color: #17343c !important;
      font-size: 24px !important;
      touch-action: manipulation;
    }
    .leaflet-right .leaflet-control-zoom { margin: 12px 12px 0 0; }
    .map-dark .leaflet-control-zoom a { background: #142d35; color: #eaf2f3 !important; }
    .map-light .leaflet-control-zoom a { background: #fff; }
    @media (max-height: 230px) {
      .leaflet-control-zoom { display: flex; }
      .leaflet-control-zoom a { border-radius: 0 !important; }
      .leaflet-control-zoom-in { border-radius: 8px 0 0 8px !important; }
      .leaflet-control-zoom-out { border-radius: 0 8px 8px 0 !important; }
    }
    @media (prefers-reduced-motion: reduce) { .leaflet-tile-pane { transition: none; } }
    .map-marker { background: transparent; border: 0; }
    .user-dot { position: relative; width: 34px; height: 34px; }
    .user-dot::before { content: ""; position: absolute; inset: 0; border-radius: 50%; background: rgba(37,99,235,.22); border: 1px solid rgba(96,165,250,.7); }
    .user-dot::after { content: ""; position: absolute; width: 14px; height: 14px; left: 10px; top: 10px; border-radius: 50%; background: #2563eb; border: 3px solid #fff; box-shadow: 0 3px 10px rgba(0,0,0,.34); }
    .nav-marker { width: 42px; height: 42px; display: grid; place-items: center; filter: drop-shadow(0 4px 6px rgba(0,0,0,.45)); }
    .nav-marker svg { width: 36px; height: 36px; }
    .bus-marker { display: flex; align-items: center; gap: 5px; width: max-content; transform: translate(-18px, -18px); }
    .bus-orb { width: 36px; height: 36px; border: 3px solid rgba(255,255,255,.92); border-radius: 12px; display: grid; place-items: center; box-shadow: 0 6px 18px rgba(0,0,0,.3); }
    .bus-orb svg { width: 19px; height: 19px; color: #fff; }
    .bus-label { color: #fff; background: rgba(8,25,31,.9); border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 5px 7px; font-size: 10px; font-weight: 800; white-space: nowrap; box-shadow: 0 5px 16px rgba(0,0,0,.24); }
    .destination-pin { width: 38px; height: 45px; position: relative; }
    .destination-pin .flag { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; background: #d85f28; border: 3px solid #fff; box-shadow: 0 5px 16px rgba(0,0,0,.28); }
    .destination-pin .flag svg { width: 17px; height: 17px; color: #fff; }
    .destination-pin::after { content: ""; position: absolute; width: 10px; height: 10px; left: 12px; top: 29px; background: #d85f28; transform: rotate(45deg); border-right: 2px solid #fff; border-bottom: 2px solid #fff; }
    .leaflet-popup-content-wrapper { border-radius: 14px; }
    .leaflet-popup-content { margin: 12px 14px; min-width: 150px; }
    .popup-title { color: #17343c; font-weight: 800; font-size: 12px; }
    .popup-copy { color: #64777c; font-size: 10px; margin-top: 4px; }
  </style>
</head>
<body class="map-dark">
  <div id="map"></div>
  <script>${LEAFLET_JS}</script>
  <script>
    (function () {
      var map;
      var tileLayer;
      var interactiveMaxZoom = L.Browser.retina ? 18 : 19;
      var routeLayer = L.layerGroup();
      var markerLayer = L.layerGroup();
      var userMarker = null;
      var busMarkers = Object.create(null);
      var destinationMarker = null;
      var routeEntries = Object.create(null);
      var accuracyCircle = null;
      var followingCamera = false;
      var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      var attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

      function send(message) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(message));
        }
      }

      function escapeHtml(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function busSvg() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="15" rx="3"/><path d="M8 18v2M16 18v2M7 8h10M8 14h.01M16 14h.01"/></svg>';
      }

      function flagSvg() {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 21V4M5 5h11l-2 4 2 4H5"/></svg>';
      }

      function navSvg(heading) {
        return '<div class="nav-marker" style="transform:rotate(' + Number(heading || 0) + 'deg)"><svg viewBox="0 0 24 24"><path d="M12 2 20 21l-8-4-8 4L12 2Z" fill="#2783ff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>';
      }

      function setTheme(theme) {
        var nextTheme = theme === 'light' ? 'light' : 'dark';
        document.body.className = 'map-' + nextTheme;
        if (tileLayer) return;
        tileLayer = L.tileLayer(tileUrl, {
          attribution: attribution,
          maxZoom: 19,
          maxNativeZoom: 19,
          detectRetina: true,
          updateWhenIdle: false,
          updateWhenZooming: true,
          keepBuffer: 4,
          referrerPolicy: 'strict-origin-when-cross-origin'
        }).addTo(map);
        tileLayer.bringToBack();
      }

      function icon(html, size, anchor) {
        return L.divIcon({ className: 'map-marker', html: html, iconSize: size, iconAnchor: anchor });
      }

      function meters(a, b) {
        var rad = Math.PI / 180;
        var dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
      }

      function routePoint(entry, distance) {
        var value = Math.max(0, Math.min(entry.total, distance));
        var low = 0, high = entry.points.length - 2;
        while (low < high) { var middle = Math.ceil((low + high) / 2); if (entry.cumulative[middle] <= value) low = middle; else high = middle - 1; }
        var length = entry.cumulative[low + 1] - entry.cumulative[low];
        var ratio = length > 0 ? (value - entry.cumulative[low]) / length : 0;
        return { point: [entry.points[low][0] + (entry.points[low + 1][0] - entry.points[low][0]) * ratio,
          entry.points[low][1] + (entry.points[low + 1][1] - entry.points[low][1]) * ratio], index: low };
      }

      function trimRoute(entry, progress) {
        if (!entry || !entry.selected || entry.progress === progress) return;
        entry.progress = progress;
        var position = routePoint(entry, progress);
        var rest = [position.point].concat(entry.points.slice(position.index + 1));
        entry.outline.setLatLngs(rest); entry.line.setLatLngs(rest);
      }

      function renderRoutes(routes) {
        var activeIds = Object.create(null);
        (routes || []).forEach(function (route) {
          var key = String(route.id);
          var points = (route.coordinates || []).map(function (point) { return [point.latitude, point.longitude]; });
          if (points.length < 2) return;
          activeIds[key] = true;
          var signature = JSON.stringify(points);
          var entry = routeEntries[key];
          if (!entry) {
            entry = routeEntries[key] = {
              outline: L.polyline(points, { lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer),
              line: L.polyline(points, { lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer)
            };
          }
          if (entry.signature !== signature) {
            entry.points = points; entry.signature = signature; entry.key = key + ':' + signature;
            entry.cumulative = [0]; entry.progress = null;
            for (var i = 1; i < points.length; i++) entry.cumulative.push(entry.cumulative[i - 1] + meters(points[i - 1], points[i]));
            entry.total = entry.cumulative[points.length - 1];
            entry.outline.setLatLngs(points); entry.line.setLatLngs(points);
          }
          if (entry.selected !== route.selected) {
            entry.selected = route.selected; entry.progress = null;
            entry.outline.setStyle({ color: '#173f87', weight: 8, opacity: route.selected ? .95 : 0 });
            entry.line.setStyle({ color: route.selected ? '#3b82f6' : '#94a3b8', weight: route.selected ? 5 : 4, opacity: route.selected ? 1 : .55, dashArray: route.selected ? null : '7 7' });
            entry.outline.setLatLngs(points); entry.line.setLatLngs(points);
            if (route.selected) { entry.outline.bringToFront(); entry.line.bringToFront(); }
          }
        });
        Object.keys(routeEntries).forEach(function (key) {
          if (!activeIds[key]) { routeLayer.removeLayer(routeEntries[key].outline); routeLayer.removeLayer(routeEntries[key].line); delete routeEntries[key]; }
        });
      }

      function panWithMarker(point) {
        followingCamera = true;
        map.panTo(point, { animate: false });
        followingCamera = false;
      }

      function moveMarker(marker, point, duration, entry, distance) {
        var routeKey = entry ? entry.key : null;
        if (marker.__targetLat === point[0] && marker.__targetLng === point[1] && marker.__routeKey === routeKey && marker.__targetProgress === distance) return;
        marker.__targetLat = point[0]; marker.__targetLng = point[1]; marker.__targetProgress = distance;
        if (marker.__moveFrame) window.cancelAnimationFrame(marker.__moveFrame);
        var start = marker.getLatLng();
        var startProgress = marker.__routeKey === routeKey && typeof marker.__progress === 'number' ? marker.__progress : distance;
        marker.__routeKey = routeKey;
        var started = performance.now();
        function frame(time) {
          var progress = duration > 0 && !reducedMotion ? Math.min(1, Math.max(0, (time - started) / duration)) : 1;
          var rendered = [start.lat + (point[0] - start.lat) * progress, start.lng + (point[1] - start.lng) * progress];
          if (entry) {
            marker.__progress = startProgress + (distance - startProgress) * progress;
            rendered = routePoint(entry, marker.__progress).point;
            trimRoute(entry, marker.__progress);
          }
          marker.setLatLng(rendered);
          if (marker === userMarker) {
            if (accuracyCircle) accuracyCircle.setLatLng(rendered);
            if (marker.__following) panWithMarker(rendered);
          }
          marker.__moveFrame = progress < 1 ? window.requestAnimationFrame(frame) : null;
          if (progress === 1 && marker === userMarker && marker.__following) reportRegion();
        }
        if (duration === 0 || reducedMotion) frame(started + duration);
        else marker.__moveFrame = window.requestAnimationFrame(frame);
      }

      function removeMarker(marker) {
        if (!marker) return;
        if (marker.__moveFrame) window.cancelAnimationFrame(marker.__moveFrame);
        markerLayer.removeLayer(marker);
      }

      function rotation(marker, heading) {
        if (typeof heading !== 'number' || !isFinite(heading)) return null;
        var previous = marker && marker.__rotation;
        return typeof previous === 'number' ? previous + ((heading - previous + 540) % 360 + 360) % 360 - 180 : heading;
      }

      function renderMarkers(payload) {
        if (payload.userMarker) {
          var user = payload.userMarker;
          var angle = rotation(userMarker, user.heading);
          var arrow = user.navigating && angle !== null;
          var userHtml = arrow ? navSvg(angle) : '<div class="user-dot"></div>';
          var userIcon = icon(userHtml, arrow ? [42, 42] : [34, 34], arrow ? [21, 21] : [17, 17]);
          var created = !userMarker;
          if (created) userMarker = L.marker([user.latitude, user.longitude], { icon: userIcon, zIndexOffset: 2500 }).addTo(markerLayer);
          else userMarker.setIcon(userIcon);
          if (user.following !== userMarker.__requestedFollow) {
            userMarker.__requestedFollow = user.following;
            userMarker.__following = !!user.following;
          }
          var entry = user.routeId != null ? routeEntries[String(user.routeId)] : null;
          var distance = entry && typeof user.progressMeters === 'number' ? Math.max(0, Math.min(entry.total, user.progressMeters)) : undefined;
          if (distance === undefined) entry = null;
          if (user.accuracyMeters > 0 && L.circle) {
            if (!accuracyCircle) accuracyCircle = L.circle([user.latitude, user.longitude], { radius: user.accuracyMeters, color: '#60a5fa', weight: 1, fillColor: '#3b82f6', fillOpacity: .09, interactive: false }).addTo(markerLayer);
            else accuracyCircle.setRadius(user.accuracyMeters);
          } else if (accuracyCircle) { markerLayer.removeLayer(accuracyCircle); accuracyCircle = null; }
          moveMarker(userMarker, [user.latitude, user.longitude], created ? 0 : 900, entry, distance);
          userMarker.__rotation = angle;
          userMarker.bindPopup('<div class="popup-title">' + escapeHtml(user.title) + '</div><div class="popup-copy">' + escapeHtml(user.description) + '</div>');
        } else {
          removeMarker(userMarker);
          userMarker = null;
          if (accuracyCircle) { markerLayer.removeLayer(accuracyCircle); accuracyCircle = null; }
        }

        var activeBusIds = Object.create(null);
        (payload.buses || []).forEach(function (bus) {
          var key = String(bus.id);
          activeBusIds[key] = true;
          var busMarker = busMarkers[key];
          var busAngle = rotation(busMarker, bus.heading);
          var speedColor = bus.speedKmh > 80 ? '#dc3b48' : (bus.speedKmh > 50 ? '#d98b18' : '#147d62');
          var busHtml = '<div class="bus-marker"><div class="bus-orb" style="background:' + speedColor + ';transform:rotate(' + (busAngle || 0) + 'deg)">' + busSvg() + '</div><div class="bus-label">' + escapeHtml(bus.plate) + ' · ' + Math.round(bus.speedKmh) + ' km/h</div></div>';
          var busIcon = icon(busHtml, [170, 42], [18, 21]);
          if (!busMarker) {
            busMarker = L.marker([bus.latitude, bus.longitude], { icon: busIcon, zIndexOffset: 1800 }).addTo(markerLayer);
            busMarkers[key] = busMarker;
            busMarker.on('click', function () { send({ type: 'BUS_PRESS', id: bus.id }); });
          } else {
            busMarker.setIcon(busIcon);
            moveMarker(busMarker, [bus.latitude, bus.longitude], 950);
          }
          busMarker.__rotation = busAngle;
          busMarker.bindPopup('<div class="popup-title">Autobús ' + escapeHtml(bus.plate) + '</div><div class="popup-copy">' + escapeHtml(bus.driver) + '<br>' + escapeHtml(bus.route) + '<br>' + Math.round(bus.speedKmh) + ' km/h</div>');
        });
        Object.keys(busMarkers).forEach(function (key) {
          if (!activeBusIds[key]) { removeMarker(busMarkers[key]); delete busMarkers[key]; }
        });

        if (payload.destination) {
          var destination = payload.destination;
          var destinationHtml = '<div class="destination-pin"><div class="flag">' + flagSvg() + '</div></div>';
          if (!destinationMarker) destinationMarker = L.marker([destination.latitude, destination.longitude], {
            icon: icon(destinationHtml, [38, 45], [19, 43]),
            zIndexOffset: 2200
          }).addTo(markerLayer);
          else destinationMarker.setLatLng([destination.latitude, destination.longitude]);
          destinationMarker.bindPopup('<div class="popup-title">' + escapeHtml(destination.title) + '</div><div class="popup-copy">' + escapeHtml(destination.description) + '</div>');
        } else {
          removeMarker(destinationMarker);
          destinationMarker = null;
        }
      }

      window.__EUNICE_MAP_UPDATE = function (payload) {
        if (!map || !payload) return;
        setTheme(payload.theme);
        if (payload.routes) renderRoutes(payload.routes);
        renderMarkers(payload);
      };
      window.__EUNICE_MAP_ROUTES = renderRoutes;

      window.__EUNICE_MAP_FLY = function (region, duration) {
        if (!map || !region) return;
        var delta = Math.max(Number(region.latitudeDelta || .035), Number(region.longitudeDelta || .035));
        var zoom = Math.max(3, Math.min(interactiveMaxZoom, Math.round(Math.log(360 / delta) / Math.LN2)));
        map.flyTo([region.latitude, region.longitude], zoom, { animate: duration !== 0 && !reducedMotion, duration: Math.max(.25, Number(duration || 600) / 1000) });
      };

      window.__EUNICE_MAP_FOLLOW = function (coordinate) {
        if (!map || !coordinate) return;
        if (userMarker) userMarker.__following = true;
        var rendered = userMarker ? userMarker.getLatLng() : null;
        map.panTo(rendered ? [rendered.lat, rendered.lng] : [coordinate.latitude, coordinate.longitude], { animate: false });
      };

      window.__EUNICE_MAP_FIT = function (coordinates, padding, animated) {
        if (!map || !coordinates || !coordinates.length) return;
        var points = coordinates.map(function (point) { return [point.latitude, point.longitude]; });
        if (points.length === 1) {
          map.flyTo(points[0], 16, { animate: animated !== false, duration: .55 });
          return;
        }
        var p = padding || {};
        map.fitBounds(L.latLngBounds(points), {
          animate: animated !== false,
          paddingTopLeft: [Number(p.left || 40), Number(p.top || 40)],
          paddingBottomRight: [Number(p.right || 40), Number(p.bottom || 40)],
          maxZoom: 18
        });
      };

      map = L.map('map', {
        center: [${INITIAL_CENTER.latitude}, ${INITIAL_CENTER.longitude}],
        zoom: 15,
        minZoom: 3,
        maxZoom: interactiveMaxZoom,
        zoomSnap: 0.5,
        zoomDelta: 1,
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true,
        dragging: true,
        touchZoom: true,
        doubleClickZoom: true,
        scrollWheelZoom: true,
        boxZoom: false,
        keyboard: false,
        zoomAnimation: true,
        fadeAnimation: true,
        markerZoomAnimation: true
      });
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.scrollWheelZoom.enable();
      map.zoomControl.setPosition('topright');
      routeLayer.addTo(map);
      markerLayer.addTo(map);
      function userGesture() {
        if (userMarker) userMarker.__following = false;
        send({ type: 'USER_GESTURE' });
      }
      map.on('dragstart', userGesture);
      var container = map.getContainer();
      container.addEventListener('wheel', userGesture);
      container.addEventListener('dblclick', userGesture);
      container.addEventListener('touchstart', function (event) { if (event.touches && event.touches.length > 1) userGesture(); }, { passive: true });
      container.addEventListener('click', function (event) {
        if (event.target && event.target.closest && event.target.closest('.leaflet-control-zoom')) userGesture();
      }, true);
      setTheme('dark');
      function reportRegion() {
        if (followingCamera) return;
        var center = map.getCenter();
        var bounds = map.getBounds();
        send({
          type: 'REGION_CHANGE',
          region: {
            latitude: center.lat,
            longitude: center.lng,
            latitudeDelta: Math.abs(bounds.getNorth() - bounds.getSouth()),
            longitudeDelta: Math.abs(bounds.getEast() - bounds.getWest())
          }
        });
      }
      map.on('moveend', reportRegion);
      window.__EUNICE_MAP_RESIZE = function () {
        if (!map) return;
        window.requestAnimationFrame(function () { map.invalidateSize({ pan: false }); });
      };
      window.addEventListener('resize', window.__EUNICE_MAP_RESIZE);
      window.addEventListener('orientationchange', function () {
        window.setTimeout(window.__EUNICE_MAP_RESIZE, 120);
      });
      if (window.ResizeObserver) {
        new ResizeObserver(window.__EUNICE_MAP_RESIZE).observe(document.getElementById('map'));
      }
      setTimeout(function () { map.invalidateSize(); send({ type: 'READY' }); }, 0);
      setTimeout(function () { map.invalidateSize(); }, 300);
    })();
  </script>
</body>
</html>`;

export const LeafletNativeMap = forwardRef<LeafletMapHandle, LeafletNativeMapProps>(({
  style,
  theme,
  initialRegion,
  userMarker,
  buses,
  destination,
  routes,
  onBusPress,
  onRegionChangeComplete,
  onUserGesture,
}, forwardedRef) => {
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const [webKey, setWebKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const document = useMemo(createLeafletDocument, []);

  const payloadScript = useMemo(() => {
    const payload = { theme, userMarker, buses, destination };
    return `window.__EUNICE_MAP_UPDATE && window.__EUNICE_MAP_UPDATE(${serializeForScript(payload)}); true;`;
  }, [buses, destination, theme, userMarker]);
  const routesScript = useMemo(() =>
    `window.__EUNICE_MAP_ROUTES && window.__EUNICE_MAP_ROUTES(${serializeForScript(routes)}); true;`, [routes]);

  useEffect(() => {
    if (readyRef.current) webViewRef.current?.injectJavaScript(routesScript);
  }, [routesScript]);

  const pushPayload = useCallback(() => {
    if (readyRef.current) webViewRef.current?.injectJavaScript(payloadScript);
  }, [payloadScript]);

  useEffect(() => {
    pushPayload();
  }, [pushPayload]);

  useImperativeHandle(forwardedRef, () => ({
    invalidateSize: () => {
      if (readyRef.current) webViewRef.current?.injectJavaScript('window.__EUNICE_MAP_RESIZE && window.__EUNICE_MAP_RESIZE(); true;');
    },
    followCoordinate: (coordinate) => {
      if (readyRef.current) webViewRef.current?.injectJavaScript(
        `window.__EUNICE_MAP_FOLLOW && window.__EUNICE_MAP_FOLLOW(${serializeForScript(coordinate)}); true;`,
      );
    },
    animateToRegion: (region, duration = 600) => {
      webViewRef.current?.injectJavaScript(
        `window.__EUNICE_MAP_FLY && window.__EUNICE_MAP_FLY(${serializeForScript(region)}, ${Number(duration)}); true;`,
      );
    },
    fitToCoordinates: (coordinates, options) => {
      webViewRef.current?.injectJavaScript(
        `window.__EUNICE_MAP_FIT && window.__EUNICE_MAP_FIT(${serializeForScript(coordinates)}, ${serializeForScript(options?.edgePadding ?? {})}, ${options?.animated !== false}); true;`,
      );
    },
  }), []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === 'READY') {
        readyRef.current = true;
        setLoading(false);
        setFailed(false);
        webViewRef.current?.injectJavaScript(
          `window.__EUNICE_MAP_FLY && window.__EUNICE_MAP_FLY(${serializeForScript(initialRegion)}, 0); true;`,
        );
        webViewRef.current?.injectJavaScript(routesScript);
        webViewRef.current?.injectJavaScript(payloadScript);
      } else if (message.type === 'BUS_PRESS' && typeof message.id === 'string') {
        onBusPress?.(message.id);
      } else if (message.type === 'REGION_CHANGE' && message.region) {
        onRegionChangeComplete?.(message.region as MapRegion);
      } else if (message.type === 'USER_GESTURE') {
        onUserGesture?.();
      }
    } catch {
      // Ignorar mensajes que no pertenezcan al puente controlado del mapa.
    }
  }, [initialRegion, onBusPress, onRegionChangeComplete, onUserGesture, payloadScript, routesScript]);

  const retry = () => {
    readyRef.current = false;
    setFailed(false);
    setLoading(true);
    setWebKey((value) => value + 1);
  };

  return (
    <View style={[styles.container, style]}>
      <WebView
        key={webKey}
        ref={webViewRef}
        source={{ html: document, baseUrl: 'https://transporteseunice.com/' }}
        originWhitelist={['https://*', 'about:blank']}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        applicationNameForUserAgent="TransportesEunice/1.0.5"
        allowsInlineMediaPlayback={false}
        geolocationEnabled={false}
        setSupportMultipleWindows={false}
        mixedContentMode="never"
        scrollEnabled
        nestedScrollEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        androidLayerType="hardware"
        style={[styles.webView, { backgroundColor: theme === 'dark' ? '#102229' : '#eef3f2' }]}
        onLayout={() => {
          webViewRef.current?.injectJavaScript('window.__EUNICE_MAP_RESIZE && window.__EUNICE_MAP_RESIZE(); true;');
        }}
        onMessage={handleMessage}
        onLoadStart={() => {
          readyRef.current = false;
          setLoading(true);
        }}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
      />
      {loading && !failed && (
        <View style={[styles.overlay, { backgroundColor: theme === 'dark' ? '#102229' : '#eef3f2' }]} pointerEvents="none">
          <ActivityIndicator color="#d85f28" size="large" />
          <Text style={[styles.statusText, { color: theme === 'dark' ? '#d4e0e2' : '#385159' }]}>Preparando el mapa…</Text>
        </View>
      )}
      {failed && (
        <View style={[styles.overlay, { backgroundColor: theme === 'dark' ? '#102229' : '#eef3f2' }]}>
          <Text style={[styles.errorTitle, { color: theme === 'dark' ? '#f4f7f7' : '#17343c' }]}>No se pudo cargar el mapa</Text>
          <Text style={[styles.errorCopy, { color: theme === 'dark' ? '#9fb2b7' : '#64777c' }]}>Comprueba la conexión a internet e inténtalo nuevamente.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={retry} activeOpacity={0.82}>
            <Text style={styles.retryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

LeafletNativeMap.displayName = 'LeafletNativeMap';

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  webView: { flex: 1, width: '100%', height: '100%' },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  statusText: { marginTop: 10, fontSize: 12, fontWeight: '700' },
  errorTitle: { fontSize: 15, fontWeight: '900', textAlign: 'center' },
  errorCopy: { marginTop: 6, maxWidth: 260, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  retryButton: { marginTop: 14, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: '#d85f28' },
  retryText: { color: '#fff', fontSize: 11, fontWeight: '900' },
});
