const { withAppBuildGradle } = require('expo/config-plugins');

const releaseCredentials = `
// Local release signing is configured from the environment. EAS Build injects its own signing
// credentials after prebuild; without either source, a local release APK remains unsigned.
def neotreeReleaseSigning = [
    storeFile: System.getenv('NEOTREE_RELEASE_KEYSTORE'),
    storePassword: System.getenv('NEOTREE_RELEASE_STORE_PASSWORD'),
    keyAlias: System.getenv('NEOTREE_RELEASE_KEY_ALIAS'),
    keyPassword: System.getenv('NEOTREE_RELEASE_KEY_PASSWORD'),
]
def neotreeReleaseSigningReady = neotreeReleaseSigning.values().every { it != null && !it.isEmpty() }
if (neotreeReleaseSigningReady) {
    android {
        signingConfigs {
            release {
                storeFile file(neotreeReleaseSigning.storeFile)
                storePassword neotreeReleaseSigning.storePassword
                keyAlias neotreeReleaseSigning.keyAlias
                keyPassword neotreeReleaseSigning.keyPassword
            }
        }
    }
}
`;

function patchReleaseSigning(contents) {
    if (contents.includes('neotreeReleaseSigningReady')) return contents;

    const androidStart = contents.indexOf('\nandroid {');
    const buildTypesStart = contents.indexOf('    buildTypes {', androidStart);
    const releaseStart = contents.indexOf('        release {', buildTypesStart);
    const releaseEnd = contents.indexOf('\n        }', releaseStart);
    if (androidStart < 0 || buildTypesStart < 0 || releaseStart < 0 || releaseEnd < 0) {
        throw new Error('Could not find the Android release build block to secure its signing');
    }

    const releaseBlock = contents.slice(releaseStart, releaseEnd);
    const debugSigning = 'signingConfig signingConfigs.debug';
    if (!releaseBlock.includes(debugSigning)) {
        throw new Error('Android release signing template changed; inspect it before building');
    }

    const securedBlock = releaseBlock.replace(debugSigning, 'if (neotreeReleaseSigningReady) signingConfig signingConfigs.release');
    const securedContents = contents.slice(0, releaseStart) + securedBlock + contents.slice(releaseEnd);
    return securedContents.slice(0, androidStart) + '\n' + releaseCredentials + securedContents.slice(androidStart);
}

module.exports = config => withAppBuildGradle(config, config => {
    if (config.modResults.language !== 'groovy') {
        throw new Error('Android release signing plugin requires a Groovy build.gradle');
    }
    config.modResults.contents = patchReleaseSigning(config.modResults.contents);
    return config;
});
module.exports.patchReleaseSigning = patchReleaseSigning;
