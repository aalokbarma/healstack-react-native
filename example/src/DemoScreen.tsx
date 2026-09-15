import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getHealStackConfig, isPlaceholderApiKey } from './config';
import {
  HealStack,
  getBeforeSendDropTagged,
  initializeHealStack,
  setBeforeSendDropTagged,
} from './setupHealStack';

type LogLine = { id: number; text: string };

let logSeq = 0;

export default function DemoScreen() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [initialized, setInitialized] = useState(() => HealStack.isInitialized());
  const [dropTagged, setDropTagged] = useState(() => getBeforeSendDropTagged());

  const cfg = useMemo(() => getHealStackConfig(), []);

  const log = useCallback((text: string) => {
    logSeq += 1;
    setLogs((prev) => [{ id: logSeq, text: `${new Date().toISOString().slice(11, 19)}  ${text}` }, ...prev].slice(0, 40));
  }, []);

  const onInit = useCallback(() => {
    const result = initializeHealStack();
    setInitialized(HealStack.isInitialized());
    log(result.message);
  }, [log]);

  const onCaptureException = useCallback(() => {
    try {
      throw new Error('Example manual exception from DemoScreen');
    } catch (error) {
      const id = HealStack.captureException(error, {
        mechanism: { type: 'generic', handled: true },
        data: { source: 'demo_button' },
      });
      log(`captureException → ${id || '(empty id)'}`);
    }
  }, [log]);

  const onCaptureMessage = useCallback(() => {
    const id = HealStack.captureMessage('Example message from DemoScreen', 'info', {
      data: { source: 'demo_button' },
    });
    log(`captureMessage → ${id || '(empty id)'}`);
  }, [log]);

  const onBreadcrumb = useCallback(() => {
    HealStack.addBreadcrumb({
      type: 'user',
      category: 'demo',
      message: 'Developer pressed Add breadcrumb',
      level: 'info',
      data: { screen: 'DemoScreen' },
    });
    log('addBreadcrumb ok');
  }, [log]);

  const onUser = useCallback(() => {
    HealStack.setUser({
      id: 'example-user-1',
      email: 'dev@example.com',
      username: 'example_dev',
    });
    log('setUser ok (email stripped on send unless sendDefaultPii)');
  }, [log]);

  const onClearUser = useCallback(() => {
    HealStack.clearUser();
    log('clearUser ok');
  }, [log]);

  const onTags = useCallback(() => {
    HealStack.setTag('feature', 'example');
    HealStack.setTags({ surface: 'demo', build: 'local' });
    log('setTag / setTags ok');
  }, [log]);

  const onClearTags = useCallback(() => {
    HealStack.clearTags();
    log('clearTags ok');
  }, [log]);

  const onFlush = useCallback(async () => {
    const ok = await HealStack.flush(10_000);
    log(`flush → ${ok ? 'drained' : 'incomplete / timed out'}`);
  }, [log]);

  const onClose = useCallback(async () => {
    const ok = await HealStack.close(10_000);
    setInitialized(HealStack.isInitialized());
    log(`close → ${ok ? 'ok' : 'flush incomplete'}; isInitialized=${HealStack.isInitialized()}`);
  }, [log]);

  const onToggleBeforeSend = useCallback(() => {
    const next = !getBeforeSendDropTagged();
    setBeforeSendDropTagged(next);
    setDropTagged(next);
    log(
      next
        ? 'beforeSend: will DROP events tagged example_drop=true'
        : 'beforeSend: will KEEP all events (still stamps example_before_send)',
    );
  }, [log]);

  const onCaptureDropCandidate = useCallback(() => {
    HealStack.setTag('example_drop', 'true');
    const id = HealStack.captureMessage('Candidate for beforeSend drop', 'warning');
    HealStack.clearTag('example_drop');
    log(
      dropTagged
        ? `captureMessage (tagged drop) → ${id || '(empty — likely dropped by beforeSend)'}`
        : `captureMessage (tagged drop) → ${id || '(empty id)'} (drop toggle is OFF)`,
    );
  }, [dropTagged, log]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>HealStack example</Text>
        <Text style={styles.subtitle}>
          Consumes <Text style={styles.mono}>@healstack/react-native</Text> via the public package
          entry (not <Text style={styles.mono}>../src</Text>).
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Configuration</Text>
          <Text style={styles.meta}>endpoint: {cfg.endpoint}</Text>
          <Text style={styles.meta}>
            apiKey: {isPlaceholderApiKey(cfg.apiKey) ? '(placeholder — set .env)' : '(set from env)'}
          </Text>
          <Text style={styles.meta}>allowHttp: {String(cfg.allowHttp)}</Text>
          <Text style={styles.meta}>
            initialized: {initialized ? 'yes' : 'no'} · beforeSend drop: {dropTagged ? 'on' : 'off'}
          </Text>
        </View>

        <Text style={styles.section}>Actions</Text>
        <DemoButton label="1. Initialize" onPress={onInit} />
        <DemoButton label="2. Capture exception" onPress={onCaptureException} />
        <DemoButton label="3. Capture message" onPress={onCaptureMessage} />
        <DemoButton label="4. Add breadcrumb" onPress={onBreadcrumb} />
        <DemoButton label="5a. Set user context" onPress={onUser} />
        <DemoButton label="5b. Clear user" onPress={onClearUser} />
        <DemoButton label="6a. Set tags" onPress={onTags} />
        <DemoButton label="6b. Clear tags" onPress={onClearTags} />
        <DemoButton label="7. Flush" onPress={() => void onFlush()} />
        <DemoButton label="8. Close" onPress={() => void onClose()} />
        <DemoButton
          label={`9a. Toggle beforeSend drop (${dropTagged ? 'ON' : 'OFF'})`}
          onPress={onToggleBeforeSend}
        />
        <DemoButton label="9b. Capture message tagged for drop" onPress={onCaptureDropCandidate} />

        <Text style={styles.section}>Log</Text>
        {logs.length === 0 ? (
          <Text style={styles.empty}>No actions yet.</Text>
        ) : (
          logs.map((line) => (
            <Text key={line.id} style={styles.logLine}>
              {line.text}
            </Text>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DemoButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f4f6f8',
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#102a43',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#486581',
    marginBottom: 8,
  },
  mono: {
    fontFamily: 'Menlo',
    fontSize: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bcccdc',
    marginBottom: 8,
  },
  cardTitle: {
    fontWeight: '600',
    marginBottom: 6,
    color: '#102a43',
  },
  meta: {
    fontSize: 12,
    color: '#486581',
    marginBottom: 2,
  },
  section: {
    marginTop: 8,
    marginBottom: 4,
    fontSize: 16,
    fontWeight: '600',
    color: '#102a43',
  },
  button: {
    backgroundColor: '#243b53',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  empty: {
    color: '#829ab1',
    fontSize: 13,
  },
  logLine: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: '#334e68',
    marginBottom: 4,
  },
});
