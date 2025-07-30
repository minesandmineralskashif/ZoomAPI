import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Button,
  StyleSheet,
  Linking,
  Image,
  ActivityIndicator,
  Share,
  Platform,
  Alert,
  ToastAndroid,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

const BACKEND_URL = 'http://192.168.X.X:3000'; // 🔁 Replace with your backend IP
const BRANCH = 'BranchA'; // 👈 Replace with your branch name

export default function App() {
  const [authorized, setAuthorized] = useState(false);
  const [meetingUrl, setMeetingUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const checkZoomAuth = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/tokens/${BRANCH}`);
      setAuthorized(res.ok);
    } catch {
      setAuthorized(false);
    }
    setLoading(false);
  };

  const handleZoomConnect = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/auth-url?branch=${BRANCH}`);
      const data = await res.json();
      if (data.url) {
        Linking.openURL(data.url);
      } else {
        showToast('Failed to get Zoom auth URL', true);
      }
    } catch {
      showToast('Zoom connect failed', true);
    }
    setLoading(false);
  };

  const handleCreateMeeting = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/create-meeting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: BRANCH }),
      });

      const data = await res.json();

      if (data.join_url) {
        setMeetingUrl(data.join_url);
        await shareMeetingLink(data.join_url);
      } else {
        showToast('Failed to create meeting', true);
      }
    } catch {
      showToast('Network error: Unable to create meeting', true);
    }
    setLoading(false);
  };

  const shareMeetingLink = async (url: string) => {
    try {
      await Share.share({ message: url });
    } catch {
      Clipboard.setString(url);
      showToast('Copied Zoom link to clipboard!');
    }
  };

  const showToast = (message: string, isError = false) => {
    if (Platform.OS === 'android') {
      ToastAndroid.showWithGravity(
        message,
        ToastAndroid.SHORT,
        ToastAndroid.CENTER
      );
    } else {
      Alert.alert(isError ? 'Error' : 'Info', message);
    }
  };

  useEffect(() => {
    checkZoomAuth();
    const subscription = Linking.addEventListener('url', () => {
      checkZoomAuth();
    });
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mines and Minerals</Text>

      <Image
        source={require('../assets/logo.png')} 
        style={styles.logo}
        resizeMode="contain"
      />

      {authorized ? (
        <Button title="Generate Zoom Link" onPress={handleCreateMeeting} />
      ) : (
        <Button title="Connect Zoom Account" onPress={handleZoomConnect} />
      )}

      {loading && <ActivityIndicator size="large" style={{ margin: 20 }} />}

      {meetingUrl && (
        <>
          <Text
            style={styles.link}
            onPress={() => Linking.openURL(meetingUrl)}
          >
            👉 Join Meeting in Browser
          </Text>

          <View style={styles.shareButtonWrapper}>
            <Button
              title="📤 Share Meeting Link"
              onPress={() => shareMeetingLink(meetingUrl)}
              color="#28a745"
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  logo: {
    width: 160,
    height: 160,
    alignSelf: 'center',
    marginBottom: 32,
  },
  link: {
    marginTop: 20,
    color: 'blue',
    textAlign: 'center',
    textDecorationLine: 'underline',
    fontSize: 16,
  },
  shareButtonWrapper: {
    marginTop: 16,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
