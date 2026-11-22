const { withAndroidManifest, withAppBuildGradle, withMainApplication, withProjectBuildGradle } = require('expo/config-plugins');

function insert(contents, marker, addition) {
  if (!contents.includes(marker)) throw new Error('Expo prebuild marker missing: ' + marker);
  if (contents.includes(addition)) return contents;
  return contents.replace(marker, marker + addition);
}

module.exports = function withStandaloneDebug(config) {
  config = withProjectBuildGradle(config, result => {
    const marker = 'apply plugin: "expo-root-project"';
    if (!result.modResults.contents.includes(marker)) throw new Error('Expo root Gradle plugin missing');
    if (!result.modResults.contents.includes('ext.minSdkVersion = 30')) {
      result.modResults.contents = result.modResults.contents.replace(marker, 'ext.minSdkVersion = 30\n' + marker);
    }
    return result;
  });
  config = withAndroidManifest(config, result => {
    const queries = result.modResults.manifest.queries ??= [{}];
    const intents = queries[0].intent ??= [];
    const action = 'android.intent.action.TTS_SERVICE';
    if (!intents.some(item => item.action?.[0]?.$?.['android:name'] === action)) {
      intents.push({ action: [{ $: { 'android:name': action } }] });
    }
    return result;
  });
  config = withAppBuildGradle(config, result => {
    result.modResults.contents = insert(result.modResults.contents, 'react {',
      '\n    if (project.findProperty("codeTutorStandalone") == "true") debuggableVariants = []');
    result.modResults.contents = insert(result.modResults.contents, 'android {',
      '\n    // Keep generated CMake object paths below the Windows Ninja limit.\n' +
      '    if (System.getProperty("os.name").toLowerCase(java.util.Locale.ROOT).contains("win")) {\n' +
      '        externalNativeBuild.cmake.buildStagingDirectory = new File(System.getProperty("java.io.tmpdir"),\n' +
      '            "cts-cxx-" + Integer.toUnsignedString(projectDir.canonicalPath.hashCode(), 16))\n' +
      '    }');
    return result;
  });
  return withMainApplication(config, result => {
    result.modResults.contents = insert(result.modResults.contents, 'getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG',
      ' && !assets.list("").orEmpty().contains("index.android.bundle")');
    return result;
  });
};
