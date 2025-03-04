import minifySettings from "../libraries/common/minify-settings.js";

/**
 Since presets can change independently of others, we have to keep track of
 the versions separately. Current versions:

 - editor-dark-mode 6 (bumped in v1.32 four times)
 - editor-theme3 3 (last bumped in v1.32)
 */

const areColorsEqual = (currentColor, oldPresetColor) => {
  // Case insensitive
  const currentColorLowercase = currentColor.toLowerCase();
  const oldPresetLowercase = oldPresetColor.toLowerCase();

  // Converts  three/four/six value syntax into eight value syntax
  const getRRGGBBAA = (hexColor) =>
    hexColor.length === 7 // #{rr}{gg}{bb}  →  #{rr}{gg}{bb}ff
      ? `${hexColor}ff`
      : hexColor.length === 5 // #{r}{g}{b}{a}  →  #{rr}{gg}{bb}{aa}
      ? `#${hexColor[1].repeat(2)}${hexColor[2].repeat(2)}${hexColor[3].repeat(2)}${hexColor[4].repeat(2)}`
      : hexColor.length === 4 // #{r}{g}{b}  →  #{rr}{gg}{bb}ff
      ? `#${hexColor[1].repeat(2)}${hexColor[2].repeat(2)}${hexColor[3].repeat(2)}ff`
      : hexColor;

  // Convert both colors to #{rr}{gg}{bb}{aa}
  const currentColorRRGGBBAA = getRRGGBBAA(currentColorLowercase);
  const oldPresetColorRRGGBBAA = getRRGGBBAA(oldPresetLowercase);

  return currentColorRRGGBBAA === oldPresetColorRRGGBBAA;
};

const areSettingsEqual = (currentValue, oldPresetValue) => {
  if (typeof oldPresetValue === "string" && oldPresetValue.startsWith("#")) {
    // We assume this is a color setting.
    if (typeof currentValue === "string") return areColorsEqual(currentValue, oldPresetValue);
  }
  return currentValue === oldPresetValue;
};

const updatePresetIfMatching = (settings, version, oldPreset = null, presetOrFn = null) => {
  if ((settings._version || 0) < version) {
    /**
     Version must be set even if transition is unnecessary;
     1) User uses custom settings
     2) User updates, transition aborts
     3) User changes settings to old preset values
     4) Without version, this change will revert after reload!

     Therefore, DO NOT REMOVE CALLS TO THIS METHOD. Instead omit oldPreset and preset
     when transition is no longer necessary.
     */
    settings._version = version;
    if (presetOrFn === null) return;
    const map = {};
    for (const key of Object.keys(oldPreset)) {
      if (!areSettingsEqual(settings[key], oldPreset[key])) return console.log(settings, oldPreset, key);
      if (typeof presetOrFn === "object") map[key] = presetOrFn.values[key];
    }

    if (typeof presetOrFn === "function") return presetOrFn(); // Custom migration logic if preset matches

    const preset = presetOrFn;

    // For newly added keys
    for (const key of Object.keys(preset.values).filter((k) => !Object.prototype.hasOwnProperty.call(oldPreset, k))) {
      map[key] = preset.values[key];
    }
    Object.assign(settings, map);
  }
};

chrome.storage.sync.get(["addonSettings", "addonsEnabled"], ({ addonSettings = {}, addonsEnabled = {} }) => {
  const func = () => {
    let madeAnyChanges = false;

    if (addonsEnabled["editor-devtools"] === true && addonsEnabled["move-to-top-bottom"] === undefined) {
      // Existing editor-devtools users should have move-to-top-bottom enabled.
      addonsEnabled["move-to-top-bottom"] = true;
      madeAnyChanges = true;
    }

    if (addonSettings["editor-dark-mode"]?.textShadow === true && addonsEnabled["custom-block-text"] === undefined) {
      // Transition v1.23 to v1.24
      // Moved text shadow option to the custom-block-text addon
      madeAnyChanges = true;
      delete addonSettings["editor-dark-mode"].textShadow;
      addonsEnabled["custom-block-text"] = addonsEnabled["editor-dark-mode"];
      addonSettings["custom-block-text"] = { shadow: true };
      // `shadow` isn't the only setting - the other setting, `bold`, is set
      // to its default (false) inside the for loop below.
    }

    if (addonsEnabled["editor-devtools"] === false) {
      // Transition 1.27.0 to 1.28.0
      // Disable addons previously part of devtools, if devtools is disabled
      if (addonsEnabled["find-bar"] === undefined) {
        madeAnyChanges = true;
        addonsEnabled["find-bar"] = false;
      }
      if (addonsEnabled["jump-to-def"] === undefined) {
        madeAnyChanges = true;
        addonsEnabled["jump-to-def"] = false;
      }
      // Transition 1.29.0 to 1.30.0
      if (addonsEnabled["middle-click-popup"] === undefined) {
        madeAnyChanges = true;
        addonsEnabled["middle-click-popup"] = false;
      }
    }

    for (const { manifest, addonId } of scratchAddons.manifests) {
      // TODO: we should be using Object.create(null) instead of {}
      const settings = addonSettings[addonId] || {};
      let madeChangesToAddon = false;

      if (addonId === "editor-dark-mode") {
        // Transition v1.27 to v1.28
        // editor-dark-mode enabled opacity to the block palette.
        // We append "cc" to the color so that it's the same as before this update.
        if (settings.palette !== undefined && settings.palette.length === 7) {
          settings.palette += "cc";
          madeAnyChanges = madeChangesToAddon = true;
        }
      }

      if (manifest.settings) {
        for (const option of manifest.settings) {
          if (settings[option.id] === undefined) {
            madeChangesToAddon = true;
            madeAnyChanges = true;

            // cloning required for tables
            settings[option.id] = JSON.parse(JSON.stringify(option.default));
          } else if (option.type === "positive_integer" || option.type === "integer") {
            // ^ else means typeof can't be "undefined", so it must be number
            if (typeof settings[option.id] !== "number") {
              // This setting was stringified, see #2142
              madeChangesToAddon = true;
              madeAnyChanges = true;
              const number = Number(settings[option.id]);
              // Checking if NaN just in case
              const newValue = Number.isNaN(number) ? option.default : number;
              settings[option.id] = newValue;
            }
          } else if (option.type === "table") {
            const tableSettingIds = option.row.map((setting) => setting.id);
            settings[option.id].forEach((item, i) => {
              option.row.forEach((setting) => {
                if (item[setting.id] === undefined) {
                  madeChangesToAddon = true;
                  madeAnyChanges = true;
                  item[setting.id] = option.default[i][setting.id];
                }
              });
              for (const def in item) {
                if (!tableSettingIds.includes(def)) {
                  madeChangesToAddon = true;
                  madeAnyChanges = true;
                  delete item[def];
                }
              }
            });
          }
        }
        if (addonId === "dark-www") {
          // Transition v1.22.0 to v1.23.0
          const scratchr2 = addonSettings.scratchr2 || {};
          if (
            (typeof scratchr2.primaryColor === "string" && scratchr2.primaryColor !== "#4d97ff") ||
            (typeof scratchr2.linkColor === "string" && scratchr2.linkColor !== "#4d97ff")
          ) {
            if (addonsEnabled["dark-www"] !== true) {
              addonsEnabled["dark-www"] = addonsEnabled.scratchr2 === true;
              Object.assign(settings, manifest.presets.find((preset) => preset.id === "scratch").values);
            }
            madeAnyChanges = madeChangesToAddon = true;
            if (typeof scratchr2.primaryColor === "string") settings.navbar = settings.button = scratchr2.primaryColor;
            if (typeof scratchr2.linkColor === "string") settings.link = scratchr2.linkColor;
            delete scratchr2.primaryColor;
            delete scratchr2.linkColor;
          }
        }

        if (addonId === "editor-dark-mode") {
          const migratingPresetsV1_32 = settings._version && settings._version < 3;
          let newPopupSettingValue = null;
          updatePresetIfMatching(
            settings,
            3,
            {
              // "Dark editor" preset
              page: "#2e2e2e",
              primary: "#47566b",
              highlightText: "#4d97ff",
              menuBar: "#47566b",
              activeTab: "#555555",
              tab: "#444444",
              selector: "#333333",
              selector2: "#333333",
              selectorSelection: "#3a3a3a",
              accent: "#333333",
              input: "#444444",
              workspace: "#444444",
              categoryMenu: "#333333",
              palette: "#222222cc",
              border: "#111111",
            },
            () => {
              newPopupSettingValue = "#47566be6";
            }
          );
          updatePresetIfMatching(
            settings,
            4,
            {
              // "TurboWarp dark" preset
              page: "#111111",
              primary: "#ff4d4d",
              highlightText: "#ff4d4d",
              menuBar: "#333333",
              activeTab: "#1e1e1e",
              tab: "#2e2e2e",
              selector: "#1e1e1e",
              selector2: "#2e2e2e",
              selectorSelection: "#111111",
              accent: "#111111",
              input: "#1e1e1e",
              workspace: "#1e1e1e",
              categoryMenu: "#111111",
              palette: "#111111cc",
              border: "#ffffff26",
            },
            () => {
              newPopupSettingValue = "#333a";
            }
          );
          updatePresetIfMatching(
            settings,
            5,
            {
              // "Scratch 2.0" preset
              page: "#ffffffff",
              primary: "#179fd7ff",
              highlightText: "#1e9ed6",
              menuBar: "#9c9ea2ff",
              activeTab: "#e6e8e8",
              tab: "#f1f2f2ff",
              selector: "#e6e8e8",
              selector2: "#e6e8e8",
              selectorSelection: "#d0d0d0ff",
              accent: "#f2f2f2",
              input: "#ffffffff",
              workspace: "#dddedeff",
              categoryMenu: "#e6e8e8ff",
              palette: "#e6e8e8cc",
              border: "#d0d1d2",
            },
            () => {
              newPopupSettingValue = "#00000099";
            }
          );
          updatePresetIfMatching(
            settings,
            6,
            {
              // "Scratch 1.x" preset
              page: "#c0c3c6",
              primary: "#5498c7",
              highlightText: "#21211f",
              menuBar: "#c0c3c6",
              activeTab: "#b9d7e5",
              tab: "#adadb5",
              selector: "#6a6a6a",
              selector2: "#7c8083",
              selectorSelection: "#404143",
              accent: "#959a9f",
              input: "#5f6265",
              workspace: "#7c8083",
              categoryMenu: "#969a9f",
              palette: "#7c8083cc",
              border: "#0000006b",
            },
            () => {
              newPopupSettingValue = "#00000099";
            }
          );

          if (!newPopupSettingValue && migratingPresetsV1_32) {
            // https://github.com/ScratchAddons/ScratchAddons/pull/5931#issuecomment-1529426595
            if (settings.primary) newPopupSettingValue = settings.primary.substring(0, 7) + "e6";
          }

          if (newPopupSettingValue) {
            console.log("Migrated `popup` setting from editor-dark-mode to: ", newPopupSettingValue);
            settings.popup = newPopupSettingValue;
            madeAnyChanges = madeChangesToAddon = true;
          }
        }

        if (addonId === "editor-theme3") {
          madeAnyChanges = madeChangesToAddon = true;
          updatePresetIfMatching(
            settings,
            1,
            {
              "motion-color": "#4a6cd4",
              "looks-color": "#8a55d7",
              "sounds-color": "#bb42c3",
              "events-color": "#c88330",
              "control-color": "#e1a91a",
              "sensing-color": "#2ca5e2",
              "operators-color": "#5cb712",
              "data-color": "#ee7d16",
              "data-lists-color": "#cc5b22",
              "custom-color": "#632d99",
              "Pen-color": "#0e9a6c",
              "sa-color": "#29beb8",
              "input-color": "#ffffff",
              text: "white",
            },
            manifest.presets.find((p) => p.id === "original")
          );
          updatePresetIfMatching(
            settings,
            2,
            {
              "motion-color": "#004099",
              "looks-color": "#220066",
              "sounds-color": "#752475",
              "events-color": "#997300",
              "control-color": "#664100",
              "sensing-color": "#1f5f7a",
              "operators-color": "#235c23",
              "data-color": "#b35900",
              "data-lists-color": "#993300",
              "custom-color": "#99004d",
              "Pen-color": "#064734",
              "sa-color": "#166966",
              "input-color": "#202020",
              text: "white",
            },
            manifest.presets.find((p) => p.id === "dark")
          );
          updatePresetIfMatching(
            settings,
            3,
            {
              "motion-color": "#4C97FF",
              "looks-color": "#9966FF",
              "sounds-color": "#CF63CF",
              "events-color": "#FFBF00",
              "control-color": "#FFAB19",
              "sensing-color": "#5CB1D6",
              "operators-color": "#59C059",
              "data-color": "#FF8C1A",
              "data-lists-color": "#FF661A",
              "custom-color": "#FF6680",
              "Pen-color": "#0FBD8C",
              "sa-color": "#29BEB8",
              "comment-color": "#FEF49C",
              "input-color": "#202020",
              text: "colorOnBlack",
            },
            manifest.presets.find((p) => p.id === "black")
          );

          if (addonSettings["editor-dark-mode"]?.darkComments === false) {
            // Transition v1.28 to v1.29
            // Override the preset color if dark comments are not enabled
            addonSettings["comment-color"] = "#FEF49C";
          }
        }
      }

      if (addonsEnabled[addonId] === undefined) addonsEnabled[addonId] = !!manifest.enabledByDefault;

      if (madeChangesToAddon) {
        console.log(`Changed settings for addon ${addonId}`);
        addonSettings[addonId] = settings; // In case settings variable was a newly created object
      }
    }

    const prerelease = chrome.runtime.getManifest().version_name.endsWith("-prerelease");
    if (madeAnyChanges)
      chrome.storage.sync.set({
        addonSettings: minifySettings(addonSettings, prerelease ? null : scratchAddons.manifests),
        addonsEnabled,
      });
    scratchAddons.globalState.addonSettings = addonSettings;
    scratchAddons.localState.addonsEnabled = addonsEnabled;
    scratchAddons.localState.ready.addonSettings = true;
  };

  if (scratchAddons.localState.ready.manifests) func();
  else scratchAddons.localEvents.addEventListener("manifestsReady", func);
});
