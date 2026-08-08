import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

const PREVIEW_URL = 'http://192.168.1.5:4173/';

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor="#060816" />
      <WebView
        source={{ uri: PREVIEW_URL }}
        style={styles.webview}
        originWhitelist={['https://*', 'http://*']}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsBackForwardNavigationGestures
        setSupportMultipleWindows={false}
        startInLoadingState
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060816',
  },
  webview: {
    flex: 1,
    backgroundColor: '#060816',
  },
});
