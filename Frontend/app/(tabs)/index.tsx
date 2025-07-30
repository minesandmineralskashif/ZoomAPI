import { useEffect, useState } from 'react';
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
import { Picker } from '@react-native-picker/picker';

import Clipboard from '@react-native-clipboard/clipboard';

const BACKEND_URL = 'zoomapi.onrender.com'; // ⬅️ Replace with your backend IP or Render URL

export default function App() {
  const [branch, setBranch] = useState<'A' | 'B' | 'C'>('A');
  const [authorized, setAuthorized] = useState(false);
  const [meetingUrl, setMeetingUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const checkZoomAuth = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/tokens/${branch}`);
      setAuthorized(res.ok);
    } catch {
      setAuthorized(false);
    }
    setLoading(false);
  };

  const handleZoomConnect = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/auth-url?branch=${branch}`);
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
      const res = await fetch(`${BACKEND_URL}/create-meeting-${branch.toLowerCase()}`, {
        method: 'POST',
      });

      const data = await res.json();

      if (data.join_url) {
        setMeetingUrl(data.join_url);
        Clipboard.setString(data.join_url);
        showToast('Copied Zoom link to clipboard!');
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
  }, [branch]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Zoom Integration</Text>



      <Text style={styles.subtitle}>Select Branch</Text>
      <View style={styles.pickerWrapper}>
        <Picker selectedValue={branch} onValueChange={(val) => setBranch(val)}>
          <Picker.Item label="Branch A" value="A" />
          <Picker.Item label="Branch B" value="B" />
          <Picker.Item label="Branch C" value="C" />
        </Picker>
      </View>

      {authorized ? (
        <Button title="Create Zoom Meeting" onPress={handleCreateMeeting} />
      ) : (
        <Button title="Connect Zoom Account" onPress={handleZoomConnect} />
      )}

      {loading && <ActivityIndicator size="large" style={{ margin: 20 }} />}

      {meetingUrl && (
        <>
          <Text style={styles.link} onPress={() => Linking.openURL(meetingUrl)}>
            👉 Join Meeting in Browser
          </Text>

          <View style={styles.shareButtonWrapper}>
            <Button
              title="📤 Share Link"
              onPress={() => shareMeetingLink(meetingUrl)}
              color="#28a745"
            />
          </View>

          <View style={styles.shareButtonWrapper}>
            <Button
              title="💬 Share on WhatsApp"
              color="#25D366"
              onPress={() => {
                const waUrl = `https://wa.me/?text=${encodeURIComponent(
                  'Join Zoom meeting: ' + meetingUrl
                )}`;
                Linking.openURL(waUrl);
              }}
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
    backgroundColor: '#fff',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 20,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  pickerWrapper: {
    marginTop: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  logo: {
    width: 160,
    height: 160,
    alignSelf: 'center',
    marginVertical: 30,
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
