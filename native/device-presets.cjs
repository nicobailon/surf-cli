"use strict";
/**
 * Device presets for emulation (based on Chrome DevTools)
 */

const DEVICE_PRESETS = {
  // Apple devices
  "iPhone 12": {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
  },
  "iPhone 13": {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
  },
  "iPhone 14": {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  },
  "iPhone 14 Pro": {
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  },
  "iPhone 14 Pro Max": {
    width: 430,
    height: 932,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  },
  "iPhone SE": {
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
  },
  "iPad": {
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
  },
  "iPad Pro": {
    width: 1024,
    height: 1366,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
  },
  "iPad Mini": {
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
  },

  // Google devices
  "Pixel 5": {
    width: 393,
    height: 851,
    deviceScaleFactor: 2.75,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
  },
  "Pixel 6": {
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Mobile Safari/537.36",
  },
  "Pixel 7": {
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
  },
  "Pixel 7 Pro": {
    width: 412,
    height: 892,
    deviceScaleFactor: 3.5,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
  },

  // Samsung devices
  "Galaxy S21": {
    width: 360,
    height: 800,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.210 Mobile Safari/537.36",
  },
  "Galaxy S22": {
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 12; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Mobile Safari/537.36",
  },
  "Galaxy S23": {
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36",
  },
  "Galaxy Tab S7": {
    width: 800,
    height: 1280,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 10; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Safari/537.36",
  },

  // Other common devices
  "Nest Hub": {
    width: 1024,
    height: 600,
    deviceScaleFactor: 2,
    mobile: false,
    touch: true,
    userAgent: "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.109 Safari/537.36 CrKey/1.54.248666",
  },
  "Nest Hub Max": {
    width: 1280,
    height: 800,
    deviceScaleFactor: 2,
    mobile: false,
    touch: true,
    userAgent: "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.109 Safari/537.36 CrKey/1.54.248666",
  },
};

// Aliases for common searches
const DEVICE_ALIASES = {
  "iphone": "iPhone 14",
  "iphone14": "iPhone 14",
  "iphone13": "iPhone 13",
  "iphone12": "iPhone 12",
  "iphonese": "iPhone SE",
  "pixel": "Pixel 7",
  "pixel7": "Pixel 7",
  "pixel6": "Pixel 6",
  "galaxy": "Galaxy S23",
  "galaxys23": "Galaxy S23",
  "ipad": "iPad",
  "ipadpro": "iPad Pro",
};

function findDevice(name) {
  // Exact match first
  if (DEVICE_PRESETS[name]) {
    return { name, preset: DEVICE_PRESETS[name] };
  }
  
  // Check aliases (case-insensitive, no spaces)
  const normalized = name.toLowerCase().replace(/\s+/g, "");
  if (DEVICE_ALIASES[normalized]) {
    const deviceName = DEVICE_ALIASES[normalized];
    return { name: deviceName, preset: DEVICE_PRESETS[deviceName] };
  }
  
  // Fuzzy match by partial name
  const lowerName = name.toLowerCase();
  for (const [deviceName, preset] of Object.entries(DEVICE_PRESETS)) {
    if (deviceName.toLowerCase().includes(lowerName)) {
      return { name: deviceName, preset };
    }
  }
  
  return null;
}

function listDevices() {
  return Object.keys(DEVICE_PRESETS).sort();
}

module.exports = { DEVICE_PRESETS, findDevice, listDevices };
