# Tool reference

182 native tools + every tool of the bundled community MCPs through the catalog.

## Studio, apps, plugins & extensions (13)

| Tool | What it does |
|---|---|
| `adobe_status` | Which Adobe apps are installed (versions, paths), running, and scriptable right now (transport: hub\|com\|afterfx\|osascript), hub panel heartbeats, and next steps. Call first in a session. |
| `adobe_launchApp` | Open an Adobe app by command — After Effects, Premiere Pro, Photoshop, Illustrator or Media Encoder — optionally with files (projects/images) and a specific version year; waits until it accepts scripts (wait:false to return immediately). No computer-use needed. |
| `adobe_quitApp` | Quit an Adobe app by command. mode: "safe" (default — refuses if anything is unsaved), "save" (saves open work first), "discard" (closes without saving), "force" (kills the process — unsaved work is lost). |
| `adobe_openFile` | Open any file in the right Adobe app (.aep→AE, .prproj→Premiere, .psd/.jpg/.png/RAW→Photoshop, .ai/.svg/.eps/.pdf→Illustrator) — launches the app first if needed. app overrides the choice. |
| `adobe_runScript` | Run raw ExtendScript inside an app — full scripting-DOM access to EVERYTHING the app exposes (AE app.project, Premiere app.project + QE (app.enableQE(); qe.project), Photoshop DOM + Action Manager, Illustrator DOM, BridgeTalk). The code is a function body: `return` a JSON-able value; helpers are preloaded (__comp, __layer, __prop, __seq, __track, __clip, __doc, __hex, __s...). ARGS holds args. Or pass file to $.evalFile a .jsx. |
| `adobe_batch` | Run many tool calls (any native tool: ae_*, pr_*, ps_*, ai_*, xapp_*, media_*, pixabay_*) in one go, in order — fewer round trips. steps:[{tool, input}]. stopOnError default true. |
| `adobe_setup` | One-time setup / repair: installs the Adobe Studio MCP Hub CEP extension (for all 4 apps), enables unsigned CEP extensions (PlayerDebugMode), and turns on After Effects "Allow Scripts to Write Files and Access Network". Restart the apps afterwards. |
| `adobe_config` | Read or set Adobe Studio MCP settings stored on this computer: pixabayKey (Pixabay API key), mediaDir (default download folder), ytdlpArgs (extra yt-dlp args). |
| `adobe_listPlugins` | Discover everything installed for the Adobe apps: effect/filter plugins (.aex/.prm/.8bf/.aip), CEP extensions (panels, with bundle ids/hosts/menus), UXP plugins, ExtendScript scripts & ScriptUI panels, AE presets (.ffx), MOGRTs, Photoshop actions. Filter by app, kind, text. For live in-app effect lists also use ae_listEffects / pr_findEffects. |
| `adobe_pluginFile` | Read or edit the files of an installed extension / script / preset (manifest.xml, panel HTML/JS, host .jsx, UXP manifest.json, scripts...). Actions: list (folder), read, write (makes a .mcpbak backup first), restore (from .mcpbak). Restricted to Adobe plugin/extension/script folders. |
| `adobe_togglePlugin` | Enable or disable an installed plugin / extension / script by path (renames to/from ".disabled" so the app skips it on next launch). Program Files locations may need the MCP to run as administrator. |
| `adobe_installPlugin` | Install an extension/plugin/script/preset from a file or folder: .zxp/.zip/folder CEP extension → user CEP folder; .ccx UXP plugin → Adobe UPIA installer; .jsx/.jsxbin → AE Scripts (or ScriptUI Panels with panel:true); .ffx → AE User Presets; .mogrt → Premiere Essential Graphics; .atn → loaded into Photoshop; .aex/.8bf/.aip/.prm → the app Plug-ins folder (admin may be needed). |
| `adobe_extensions` | Talk to CEP extensions/panels LIVE inside a running app (through the Adobe Studio MCP Hub): list loaded extensions, open or close a panel by extension id, dispatch a CSEvent to extensions (many panels listen for events), listen for events and read them back, get host environment. Call a panel's ExtendScript functions with adobe_runScript. |

## After Effects (72)

| Tool | What it does |
|---|---|
| `ae_getCompState` | After Effects: read the active (or named) comp — size, fps, duration, current time, work area and every layer (index, name, type, enabled, in/out, parent, 3D, blend, matte). Call this first. |
| `ae_getLayer` | After Effects: full detail of one layer — transform values, keyframe counts, expressions, effects, masks, text. |
| `ae_createComp` | After Effects: create a composition (defaults 1920x1080, 30 fps, 10 s) and open it in the viewer. |
| `ae_addTextLayer` | After Effects: add a text layer (point text, or paragraph text when boxSize is given) with font, size, color, stroke, tracking, leading, justification and position (default comp center). |
| `ae_styleText` | After Effects: restyle an existing text layer — font, size, color, tracking, leading, justification, caps, faux bold/italic, real text stroke (strokeColor/strokeWidth/strokeOverFill), optionally new text. |
| `ae_addTextAnimator` | After Effects: per-character text animator with a range-selector reveal — typewriter, fadeInChars, scaleInChars, slideInChars, tracking — over `duration` seconds from startTime. basedOn chars\|words\|lines. |
| `ae_addSolid` | After Effects: add a solid layer (default comp size, full duration). |
| `ae_addNull` | After Effects: add a null object (for parenting / rigs), optionally 3D and positioned. |
| `ae_addAdjustment` | After Effects: add an adjustment layer (optionally with effects by name/matchName) affecting everything below it. |
| `ae_addShapeLayer` | After Effects: add a vector shape layer — rect, roundedRect, ellipse, polygon, star or custom path (points [[x,y],...] relative to the layer center) — with hex fill/stroke. position = layer center (default comp center). |
| `ae_addMask` | After Effects: add a mask to a layer — rect [x,y,w,h], ellipse [x,y,w,h] or path points (layer space) — with mode, feather, expansion, opacity, inverted. |
| `ae_addEffect` | After Effects: add ANY effect (built-in or third-party plugin) by display name or matchName, optionally setting parameters {paramName: value} (colors as hex). Use ae_listEffects to discover installed effects. |
| `ae_setEffectProperties` | After Effects: set parameters of an effect already on a layer: properties {paramNameOrIndex: value}. With time, sets keyframes. |
| `ae_setEffectKeyframe` | After Effects: keyframe one effect parameter at a time (optional ease influence %, interpolation linear\|bezier\|hold). |
| `ae_setEffectExpression` | After Effects: set (or clear with "") an expression on an effect parameter. |
| `ae_addExpressionControl` | After Effects: add an expression control (slider/angle/checkbox/color/point/point3d/layer/dropdown) to rig expressions against. |
| `ae_setExpression` | After Effects: set (or clear with "") an expression on any property — aliases (position, scale, rotation, opacity, anchorPoint...) or a path like "Effects>Gaussian Blur>Blurriness" / "Contents>Rectangle 1>...". Returns the expression error if any. |
| `ae_applyExpressionTemplate` | After Effects: apply a ready-made expression — wiggle, wiggleSmooth, loopCycle, loopPingpong, loopOffset, loopContinue, bounce, inertia, overshoot, time. params tune it (freq/amp/decay/rate/elasticity/gravity/bounces). bounce/inertia/overshoot ride after your keyframes. |
| `ae_linkProperties` | After Effects: drive targetLayer.targetProperty from sourceLayer.sourceProperty with an expression (pick-whip), optionally from another comp, scaled by multiplier and offset. |
| `ae_setKeyframe` | After Effects: set one keyframe on any property (aliases or path) at time with value; optional ease influence %, interpolation, easeIn/easeOut. |
| `ae_setKeyframes` | After Effects: bulk-set many keyframes in one call (cheapest way to build motion). keys: [{layer, property, time, value, ease?, easeIn?, easeOut?, interpolation?}]. |
| `ae_getKeyframes` | After Effects: list keyframes of a property — time, value, interpolation and temporal ease. |
| `ae_setKeyframeEase` | After Effects: directional/asymmetric temporal ease on an existing keyframe (by time, keyIndex, or all:true): influenceIn/Out 0-100, speedIn/Out. |
| `ae_setInterpolation` | After Effects: set keyframe interpolation (linear\|bezier\|hold, in/out separately), plus roving / auto-bezier / continuous for spatial props. keyIndex, time, or all keys. |
| `ae_setTransform` | After Effects: set transform — position, scale (number or [x,y]), rotation, opacity, anchorPoint, xRotation, yRotation, orientation. With time, sets keyframes instead. |
| `ae_setBlendingMode` | After Effects: set a layer blending mode (normal, add, screen, multiply, overlay, softLight, hardLight, colorDodge, colorBurn, difference, luminosity, color, hue, ... any AE mode name). |
| `ae_setMotionBlur` | After Effects: toggle motion blur on layers (or all) and the comp switch; shutterAngle/phase/samples. |
| `ae_setTrackMatte` | After Effects: use matteLayer as track matte for layer (alpha\|alphaInverted\|luma\|lumaInverted\|none). Image on top, shape as alpha matte = clip image into shape. |
| `ae_trimLayer` | After Effects: set a layer inPoint/outPoint (or duration) and/or startTime (slides the layer). |
| `ae_parentLayer` | After Effects: parent layer(s) to a parent layer (or unparent with parent null). |
| `ae_reorderLayer` | After Effects: move a layer to index, or to top/bottom, or above/below another layer. |
| `ae_duplicateLayer` | After Effects: duplicate a layer (count copies), optionally rename and offset each copy in time. |
| `ae_deleteLayer` | After Effects: delete one or more layers (undoable with Ctrl+Z). |
| `ae_precompose` | After Effects: precompose layers into a new comp (moveAllAttributes default true), optionally open it. |
| `ae_importImage` | After Effects: import an image/video/audio/PSD/AI file into the project and (default) add it to the comp — fit contain\|cover\|width\|height\|none, position, scale, name. asGuide:true makes a locked 50% guide layer for tracing a reference. PSD/AI with asComp:true import as a layered comp. |
| `ae_exportFrame` | After Effects: render one frame of the comp to PNG (default current time) and return it as an image so you can check your work. |
| `ae_applyGradient` | After Effects: apply a reliable gradient (Gradient Ramp) with real colors. stops [{color:hex}, ...] (first + last used), type linear\|radial, angleDeg (linear direction). |
| `ae_getProjectState` | After Effects: project overview — file path, dirty flag, bit depth, every item (comps/footage/folders with ids, sizes, durations, folder), render queue count, AE version. |
| `ae_openProject` | After Effects: open an .aep/.aepx project (current one must be saved, or pass discardChanges:true). |
| `ae_newProject` | After Effects: start a new empty project (refuses if the current one is unsaved unless discardChanges:true). |
| `ae_saveProject` | After Effects: save the project (Ctrl+S), or Save As when path is given. backup:true also writes a timestamped copy into a "Backups" folder next to the project. |
| `ae_importFile` | After Effects: import files (footage, audio, image sequences, PSD/AI as comp or footage, .aep projects, .prproj Premiere projects) into a project folder without adding to a comp. |
| `ae_manageItems` | After Effects: project item ops — rename, move to folder, delete, replace footage source (relink), set label, create folder, consolidate/reduce/remove unused. |
| `ae_setCompSettings` | After Effects: change comp settings — name, width, height, duration, frameRate, pixelAspect, bgColor, work area, render 3D renderer, preserve resolution, shy/frame-blending switches. |
| `ae_openComp` | After Effects: open a comp in the viewer/timeline and optionally move the playhead (time) — makes it the active comp. |
| `ae_setCurrentTime` | After Effects: move the comp playhead (current time indicator). |
| `ae_addCamera` | After Effects: add a 3D camera (preset focal length mm, e.g. 35/50/85), with optional position/pointOfInterest, one-node (no POI), depth of field (focusDistance, aperture, blurLevel). |
| `ae_addLight` | After Effects: add a light — point, spot, parallel, ambient — color, intensity %, position, cone angle/feather, casts shadows. |
| `ae_set3D` | After Effects: make layers 3D (or 2D) and optionally set z position (depth) for parallax, plus material options (castsShadows, acceptsLights, acceptsShadows). |
| `ae_cameraMove` | After Effects: animate a camera with a cinematic preset — pushIn, pullOut, truckLeft, truckRight, pedestalUp, pedestalDown, orbit — from startTime over duration, distance px, with smooth ease. Creates a camera if none. |
| `ae_setLayerSwitches` | After Effects: set layer switches — enabled, audioEnabled, solo, shy, locked, guide, collapseTransformation, adjustment, effectsActive, motionBlur, frameBlending, quality (best\|draft\|wireframe), label (0-16), name, comment, autoOrient, timeRemap. |
| `ae_setProperty` | After Effects: set ANY property by path (any group, effect, shape content, text animator, layer style, material, camera option...) e.g. "Contents>Rectangle 1>Contents>Fill 1>Color", "Effects>CC Light Rays>Intensity", "Layer Styles>Drop Shadow>Opacity". Optional time = keyframe. |
| `ae_getProperties` | After Effects: dump the property tree of a layer (or a sub-group path) — names, matchNames, values, keys, expressions — to discover exact paths for ae_setProperty / ae_setKeyframe. |
| `ae_selectLayers` | After Effects: select layers (and deselect others) — needed before menu commands that act on the selection (ae_executeCommand). |
| `ae_addMarkers` | After Effects: add comp or layer markers [{time, comment?, duration?, chapter?, url?, label?}] — e.g. VO word/sync markers. |
| `ae_getMarkers` | After Effects: list comp markers (or a layer's markers). |
| `ae_deleteMarkers` | After Effects: delete comp/layer markers — all, by index list, or within a time range. |
| `ae_timeRemap` | After Effects: enable time remapping on a footage/precomp layer and set remap keys [{time, sourceTime}] (freeze frames, speed ramps), or freezeAt a single time. |
| `ae_timeStretch` | After Effects: time-stretch a layer (stretch % — 200 = half speed, -100 = reverse) or set playback speed %. |
| `ae_sequenceLayers` | After Effects: arrange layers one after another (like Keyframe Assistant > Sequence Layers) with overlap seconds, or stagger start times by offset. |
| `ae_alignLayers` | After Effects: align layers to the comp — left, hCenter, right, top, vCenter, bottom, center — with margin px (uses visual bounds, respects anchor point). |
| `ae_listEffects` | After Effects: list every installed effect — built-in AND third-party plugins (Red Giant, Sapphire, BorisFX, Video Copilot...) — displayName, matchName, category. Filter by text/category. |
| `ae_applyPreset` | After Effects: apply an animation preset (.ffx — including third-party preset packs) to layers. |
| `ae_executeCommand` | After Effects: run ANY menu command by name ("Create Shapes from Vector Layer", "Convert Audio to Keyframes", "Drop Shadow" layer style, "Scene Edit Detection", script/panel names under Window...) or numeric command id. Acts on the current selection — use ae_selectLayers first. |
| `ae_runScriptFile` | After Effects: run a .jsx/.jsxbin script file (any installed script, ScriptUI panel or tool) and return its last value. Scripts in Scripts/ScriptUI Panels can be found with adobe_listPlugins. |
| `ae_addToRenderQueue` | After Effects: add a comp to the Render Queue with output path, output-module template (e.g. "H.264 - Match Render Settings - 15 Mbps", "Lossless", "High Quality with Alpha") and render-settings template; work area or custom range. |
| `ae_renderQueue` | After Effects: Render Queue — list items/status, clear (remove all), remove index, or render now (blocking, AE internal renderer). |
| `ae_queueInAME` | After Effects: send queued Render Queue items to Adobe Media Encoder (preferred render path), optionally adding a comp first and starting the AME queue immediately. |
| `ae_essentialGraphics` | After Effects: add properties to the Essential Graphics panel ({layer, property, name?}[]), set template name, and/or export the comp as a .mogrt for Premiere. |
| `ae_purgeMemory` | After Effects: purge caches (all memory & disk cache / undo / image cache) to free RAM on heavy projects. |
| `ae_shapesFromVector` | After Effects: convert an Illustrator/vector footage layer into native editable shape layers (Create Shapes from Vector Layer). |
| `ae_audioToKeyframes` | After Effects: Convert Audio to Keyframes on an audio layer (creates "Audio Amplitude" null with sliders) — for audio-reactive animation. |

## Premiere Pro (39)

| Tool | What it does |
|---|---|
| `pr_newProject` | Premiere Pro: create a new project at path (.prproj) and make it current (save the open project first). |
| `pr_getProjectState` | Premiere Pro: project name/path, sequences (name, id, active) and every project item (bins, clips, sequences, media paths). Call before referencing items. |
| `pr_getSequenceState` | Premiere Pro: active (or named) sequence — frame size, fps, duration, playhead, in/out, every video/audio track (mute/lock) with its clips (1-based index, name, start/end, source in/out, enabled, speed, media path) and markers. Clip numbers change after edits: re-read. |
| `pr_openSequence` | Premiere Pro: open a sequence in the timeline and make it active. |
| `pr_createSequence` | Premiere Pro: create a sequence — from clips (settings match the first clip), from a .sqpreset, or a default preset then width/height/fps applied (e.g. 3840x2160 @ 25). |
| `pr_duplicateSequence` | Premiere Pro: duplicate a sequence (safe copy before big/destructive edits) and optionally rename the copy / open it. |
| `pr_importFiles` | Premiere Pro: import media files (video, audio, images, PSD, AI, .aep comps, .mogrt, .srt) into a bin (created if missing). numberedStills imports an image sequence. |
| `pr_createBin` | Premiere Pro: create a bin (nested paths like "Footage/Day 1" supported). |
| `pr_moveItems` | Premiere Pro: move project items (names/paths) into a bin; also rename or set a color label. |
| `pr_placeClip` | Premiere Pro: place a project item (name/path/media path — or a file path, imported automatically) on a track at a time — overwrite (default) or insert (ripples) — optionally trimmed to source inPoint/outPoint seconds. |
| `pr_removeClips` | Premiere Pro: remove clips from the timeline (media stays in the project). ripple:true closes the gap. |
| `pr_razor` | Premiere Pro: razor (cut) at one or more times across all tracks or the listed tracks. |
| `pr_removeRange` | Premiere Pro: cut a time range out of the timeline (razor at start & end, remove what is inside) on all or listed tracks; ripple (default true) shifts later clips left to close the gap. Duplicate the sequence first for safety. |
| `pr_trimClip` | Premiere Pro: trim a timeline clip — new timeline start/end (seconds) and/or source inPoint/outPoint. |
| `pr_moveClip` | Premiere Pro: move a clip in time (toTime or by offset seconds) and/or to another track of the same type (toTrack, re-placed with the same source in/out). |
| `pr_setClipEnabled` | Premiere Pro: enable/disable clips (disabled clips stay on the timeline but do not render). |
| `pr_setClipProperties` | Premiere Pro: set Motion/Opacity on video clips (scale %, position [x,y] px 0,0 top-left, rotation deg, anchorPoint px, opacity 0-100) or volume dB on audio clips. keyframes:[{time (timeline s), scale?, position?, rotation?, opacity?, volume?, interpolation?}] are ADDED. A static value on a keyframed parameter is refused unless replaceKeyframes:true. |
| `pr_getClipProperties` | Premiere Pro: every effect component on a clip with its parameters, values and keyframes (Motion, Opacity, Volume, Lumetri, plugins...). |
| `pr_findEffects` | Premiere Pro: search installed video/audio effects and transitions — built-in AND third-party plugins — by name. |
| `pr_applyEffect` | Premiere Pro: apply a video or audio effect (built-in or plugin, by exact name from pr_findEffects) to clips, optionally setting its parameters {paramName: value}. |
| `pr_setEffectProperties` | Premiere Pro: set parameters of any effect component on a clip (by component displayName, e.g. "Lumetri Color", "Gaussian Blur", "Motion") — static values or keyframes [{time, value}] (timeline s). Colors as hex. |
| `pr_applyTransition` | Premiere Pro: add a transition (video: "Cross Dissolve", "Dip to Black", "Film Dissolve"...; audio: "Constant Power"...) at the start, end or both of clips, duration seconds. |
| `pr_addGraphic` | Premiere Pro: place a Motion Graphics template — built-in by name (e.g. "Basic Title", "Basic Lower Third") or a .mogrt path (also AE-exported) — on a video track at time; set its text (or texts {paramName: text}) and duration. Returns editable parameter names. |
| `pr_importCaptions` | Premiere Pro: import an .srt (or other caption file) onto a new caption track starting at time (default 0). |
| `pr_addCaptions` | Premiere Pro: add text captions/subtitles from cues [{start, end, text}] (seconds) — builds an .srt and creates a caption track on the sequence. Reliable editable on-screen text. |
| `pr_addMarkers` | Premiere Pro: add sequence markers [{time, name?, comment?, duration?, color 0-7?, type comment\|chapter\|segmentation\|weblink, url?}] — e.g. review points before cuts. |
| `pr_deleteMarkers` | Premiere Pro: delete sequence markers — all, by name, or in a time range. |
| `pr_getSelection` | Premiere Pro: clips currently selected in the timeline (track + 1-based index usable as clip refs). |
| `pr_setInOut` | Premiere Pro: set (or clear) sequence in/out points — or a project item's source in/out with item. |
| `pr_setPlayhead` | Premiere Pro: move the timeline playhead to a time. |
| `pr_saveProject` | Premiere Pro: save the project (or Save As path); backup:true also writes a timestamped copy into a "Backups" folder next to it. |
| `pr_exportFrame` | Premiere Pro: export the frame at a time (default playhead) as PNG and return it as an image to check the edit. |
| `pr_export` | Premiere Pro: export a sequence with an .epr preset — via Adobe Media Encoder queue (default, starts batch) or directly inside Premiere (direct:true, blocking). range entire\|inToOut\|workArea. Default preset: "Match Source - Adaptive High Bitrate". |
| `pr_exportProjectFile` | Premiere Pro: export the sequence as Final Cut Pro XML (interchange with AE/DaVinci/others), as an AAF, or as a standalone trimmed .prproj (exportAsProject). |
| `pr_setClipSpeed` | Premiere Pro: change clip speed (percent, 200 = 2x), reverse, maintain audio pitch, ripple. |
| `pr_tracks` | Premiere Pro: track operations — add video/audio tracks, mute/unmute, lock/unlock, target/untarget tracks (for inserts/pastes). |
| `pr_clipOps` | Premiere Pro: clip operations — select/deselect, link/unlink (selection), rename, set color label, replace footage (changeMediaPath on the project item), set name of item. |
| `pr_sequenceOps` | Premiere Pro: sequence-level AI/automation — autoReframe (new aspect sequence, e.g. 9:16 for Shorts), sceneEditDetection (markers or cuts on selected clips), createSubsequence (from in/out), rename, close. |
| `pr_applyEditPlan` | Premiere Pro: run many pr_* steps in ONE call, in order: steps:[{tool:"pr_addMarkers", input:{...}}, ...]. Stops at the first error unless stopOnError:false. (Works for any native tool, so ae_/ps_/ai_/xapp_ steps can be mixed in.) |

## Photoshop (22)

| Tool | What it does |
|---|---|
| `ps_getState` | Photoshop: open documents and the active document — size, resolution, mode, bit depth, path, saved flag, full layer tree (type/kind, visibility, opacity, blend, bounds, text), active layer. |
| `ps_newDocument` | Photoshop: create a new document (px) — width, height, resolution, name, mode rgb\|cmyk\|gray\|lab, fill white\|black\|transparent\|background, bits 8\|16\|32. |
| `ps_openFile` | Photoshop: open image/PSD/PDF/RAW files (asSmartObject opens as smart object). |
| `ps_saveDocument` | Photoshop: save the document — in place (Ctrl+S) or as psd\|psb\|png\|jpg\|tif\|pdf\|webp to path (asCopy default true for non-PSD), jpg quality 0-12, then optionally close. |
| `ps_closeDocument` | Photoshop: close a document — save:true saves first, otherwise changes are discarded. |
| `ps_layerOps` | Photoshop: layer operations — select, rename, show, hide, opacity, fillOpacity, blend, delete, duplicate, moveTop, moveBottom, moveUp, moveDown, lock, unlock, rasterize, mergeDown, translate [dx,dy], resize % [x,y], rotate deg, newLayer, newGroup, groupLayers (names), fillColor. |
| `ps_addTextLayer` | Photoshop: add a text layer — text, font (PostScript name), size pt, color, position [x,y] px, justification, paragraph box [w,h], tracking, leading, allCaps, fauxBold. |
| `ps_placeFile` | Photoshop: place a file (image, PSD, AI, PDF, video) as an embedded or linked smart object, optionally scaled % and moved so its center is at position [x,y]. |
| `ps_adjustmentLayer` | Photoshop: add an adjustment layer — brightnessContrast {brightness, contrast}, hueSaturation {hue, saturation, lightness, colorize}, vibrance {vibrance, saturation}, exposure {exposure, offset, gamma}, levels, curves, colorBalance, blackAndWhite, photoFilter, channelMixer, invert, posterize {levels}, threshold {level}, gradientMap, selectiveColor. clip:true clips it to the layer below. |
| `ps_applyFilter` | Photoshop: apply a filter to a layer (converts smart objects? no — on smart objects use ps_actionManager for smart filters) — gaussianBlur {radius}, motionBlur {angle, distance}, unsharpMask {amount, radius, threshold}, addNoise {amount, mono}, highPass {radius}, median {radius}, dustAndScratches {radius, threshold}, clouds, lensFlare? (use ps_actionManager for any other / third-party filter). |
| `ps_selection` | Photoshop: selections — all, none, invert, rect [x,y,w,h], ellipse [x,y,w,h], subject (AI Select Subject), sky, layerTransparency, feather {value}, expand {value}, contract {value}, smooth {value}; then optional fill hex, delete, or mask (adds a layer mask from the selection). |
| `ps_removeBackground` | Photoshop: AI Remove Background on a layer (adds a layer mask around the subject; smart objects/backgrounds are converted as needed). |
| `ps_contentAwareFill` | Photoshop: content-aware fill the current selection (or rect [x,y,w,h]) on the active/named layer — removes objects. |
| `ps_layerStyle` | Photoshop: add layer effects — stroke {size, color, position outside\|inside\|center, opacity}, dropShadow {distance, size, angle, opacity, color, spread}, outerGlow {size, opacity, color, spread}. clear:true removes all effects. |
| `ps_resize` | Photoshop: image size (width/height px, resample), canvas size (anchor), crop [left,top,right,bottom], rotate canvas deg, trim transparent pixels, flatten, flip horizontal/vertical. |
| `ps_smartObject` | Photoshop: smart objects — convert layer to smart object, edit contents (opens it), replace contents with a file, export contents to a file, rasterize. |
| `ps_runAction` | Photoshop: play a recorded action from the Actions panel (action name + set name) — including third-party action packs. loadAtn loads an .atn file first. |
| `ps_actionManager` | Photoshop: run ANY Photoshop command (full feature access incl. every filter, neural/AI command, third-party plugin filter, menu item) with batchPlay-style JSON: commands:[{"_obj":"gaussianBlur","radius":{"_unit":"pixelsUnit","_value":4}}, {"_obj":"set","_target":[{"_ref":"layer","_enum":"ordinal","_value":"targetEnum"}],"to":{"_obj":"layer","opacity":{"_unit":"percentUnit","_value":50}}}]. IDs are stringIDs; prefix "$" for a charID ("$Lyr "). Returns result descriptors. dialogs:true shows the plugin dialog. |
| `ps_getDescriptor` | Photoshop: read Action Manager properties (application, document, layer, channel...) as JSON — e.g. target [{"_ref":"layer","_enum":"ordinal","_value":"targetEnum"}], optional property "layerEffects". Discover what ps_actionManager can set. |
| `ps_runMenuCommand` | Photoshop: run a menu item by its stringID (e.g. "flattenImage", "newPlacedLayer", "copyMerged", "selectAllLayers", "toggleRulers") via app.runMenuItem. |
| `ps_exportLayers` | Photoshop: export each top-level layer (or the listed ones) as its own PNG (trimmed or full canvas) into a folder — e.g. cut-outs for After Effects parallax. |
| `ps_preview` | Photoshop: render the current document (merged, downscaled to maxSize px) and return it as an image to check your work. |

## Illustrator (16)

| Tool | What it does |
|---|---|
| `ai_getState` | Illustrator: open documents and the active one — size, color mode, artboards (rects), layers (visible/locked/item counts), selection, item counts by type. |
| `ai_newDocument` | Illustrator: new document — width/height px (pt), color mode rgb\|cmyk, number of artboards, name. |
| `ai_openFile` | Illustrator: open .ai/.pdf/.eps/.svg files. |
| `ai_saveDocument` | Illustrator: save in place, or save as .ai (PDF-compatible, best for After Effects import) / .pdf / .eps / .svg to path; optionally close. |
| `ai_closeDocument` | Illustrator: close a document (save:true saves first, else discards changes). |
| `ai_export` | Illustrator: export artboard(s) or the document — png (scale %, transparent), jpg, svg, pdf, psd (layered, for Photoshop/AE). Returns the PNG inline when preview:true. |
| `ai_addShape` | Illustrator: draw rect, roundedRect, ellipse, polygon, star, line or path (points [[x,y],...]) at position [x,y] (top-left of the shape, artboard coords) with size [w,h], fill/stroke hex (or "none"), strokeWidth, opacity, name, layer. |
| `ai_addText` | Illustrator: add point text (or area text with box [w,h]) at position [x,y] — font (PostScript name), size, color, justification, tracking, leading, name, layer; outline:true converts to outlines. |
| `ai_modifyItems` | Illustrator: modify items (by name or selection) — fill, stroke, strokeWidth, opacity, moveBy [dx,dy], position [x,y], resize % [x,y], rotate deg, rename, hide/show, lock/unlock, zOrder (front\|back\|forward\|backward), group, ungroup, delete, duplicate, blendMode. |
| `ai_layers` | Illustrator: layer ops — list, add, rename, delete, show, hide, lock, unlock, moveToTop, moveToBottom, setActive; moveItems moves named items into the layer. |
| `ai_select` | Illustrator: select items — all, none, by names, by type (PathItem/TextFrame/PlacedItem/GroupItem...), by layer, or by fill color hex. |
| `ai_executeMenuCommand` | Illustrator: run ANY menu command by its command string on the current selection — e.g. "group", "ungroup", "outline" (create outlines), "expandStyle", "Live Pathfinder Add", "Live Pathfinder Subtract", "makeMask", "OffsetPath v22", "Make Envelope", "Expand3", "selectall", "deselectall", "fitin", "Live Blend". Third-party plugin menu items work too. |
| `ai_runAction` | Illustrator: play a recorded action (action + set), optionally loading an .aia action file first. |
| `ai_placeFile` | Illustrator: place an image/PDF/PSD/SVG file at position [x,y] with optional width (keeps ratio); embed:true embeds it; trace:true runs Image Trace (preset e.g. "High Fidelity Photo", "Black and White Logo", "6 Colors") and expands to vectors. |
| `ai_applyEffect` | Illustrator: apply a Live Effect via its XML definition to items/selection — e.g. <LiveEffect name="Adobe Drop Shadow"><Dict data="R horz 7 R vert 7 R blur 5 R opac 0.75 I mode 2"/></LiveEffect>, "Adobe Gaussian Blur", "Adobe Round Corners", "Adobe Offset Path", plugin effects. |
| `ai_artboards` | Illustrator: artboards — list, add [x,y,w,h], remove index, rename, resize rect, setActive, fitToArtwork, rearrange (columns, spacing). |

## Cross-app, YouTube & Pixabay (16)

| Tool | What it does |
|---|---|
| `media_youtubeDownload` | Download video or audio from YouTube (videos, Shorts, playlists) — and 1000+ other sites — with yt-dlp. Formats: mp4 (default, edit-friendly H.264+AAC for AE/Premiere), mov, mkv, webm, mp3, wav, m4a, aac, flac, opus, ogg. quality: best\|2160\|1440\|1080\|720\|480\|360. Clip only a section with start/end. Subtitles (.srt), thumbnail, playlist. Optionally import straight into an Adobe app. Only download content you own or have permission/licence to use. |
| `media_info` | Inspect a YouTube (or other) URL without downloading — title, channel, duration, available resolutions/formats, chapters, subtitles, playlist entries. |
| `media_tools` | Manage the media helper tools: status (yt-dlp/ffmpeg paths & versions), install, update (yt-dlp -U — fixes most YouTube errors), or convert a local file with ffmpeg (to mp4 H.264 / mov ProRes / mp3 / wav / gif / extract audio). |
| `pixabay_search` | Search Pixabay (free licence stock) through the official developer API — photos, illustrations, vectors, videos (film/animation). Filters: orientation, category, colors, min size, editors choice, order popular\|latest, safesearch, page/perPage, lang. Returns ids, tags, sizes, previews. (The public API has no music or sound effects.) |
| `pixabay_download` | Download Pixabay assets by id (from pixabay_search) to disk — images at the best size your key allows (large 1280px, or full-res / vector SVG/AI with full API access), videos at large (4K/1080p) \| medium \| small \| tiny — then optionally import them into AE / Premiere / Photoshop / Illustrator. |
| `media_import` | Import downloaded/local media into an Adobe app in one call: ae (project + optional add to comp), pr (bin + optional place on track at time, one after another), ps (place as smart objects in the active doc, or open), ai (place into the active doc, or open). |
| `xapp_bridgeTalk` | BridgeTalk: from one running Adobe app, send ExtendScript to another (targets: aftereffects, premierepro, photoshop, illustrator, ame, bridge, indesign... optionally versioned "photoshop-27.0") and wait for its result — Adobe's native inter-app messaging. Useful when the target has no direct connection. |
| `xapp_aeCompToPremiere` | Dynamic Link: bring After Effects comps into Premiere Pro WITHOUT rendering (live-linked; edits in AE update in Premiere). Uses the saved .aep (saves the open AE project first if aepPath omitted). Optionally places the first comp on a track at time. |
| `xapp_premiereToAE` | Send a Premiere Pro sequence to After Effects: saves the Premiere project (or exports a trimmed project with just that sequence), then imports it into AE — sequences become AE comps with the clips as layers (like "Replace with After Effects Composition", but scriptable). |
| `xapp_photoshopToAE` | Photoshop → After Effects: save the active (or named) PSD, import it into AE as a layered composition (each PS layer = AE layer, layer styles editable), optionally adding it into a target comp — ideal for parallax / paper-cut animations. |
| `xapp_illustratorToAE` | Illustrator → After Effects: save the active AI document (PDF-compatible), import it into AE as a layered comp, and (shapes:true, default) convert every vector layer to native editable AE shape layers. |
| `xapp_frameToPhotoshop` | Grab a frame from After Effects (comp) or Premiere (sequence) at a time and open it in Photoshop (new document or as a layer in the active one) — thumbnails, retouching, matte painting. |
| `xapp_toPremiere` | Photoshop / Illustrator → Premiere Pro: save the active PS document (PSD or PNG) or export the active AI artboard (PNG), import into a Premiere bin and optionally place on a track at time with a duration. |
| `xapp_mogrtToPremiere` | After Effects → Premiere via Motion Graphics template: publish chosen AE properties to Essential Graphics, export the comp as .mogrt, and place it in Premiere with text overrides — editable titles/lower-thirds in the edit. |
| `xapp_renderAEToPremiere` | Render an After Effects comp to a file (AE render queue, blocking; e.g. ProRes 4444 / "High Quality with Alpha" / H.264) and import + place the result in Premiere — when Dynamic Link playback is too heavy. |
| `xapp_preview` | Look at what any app currently shows: AE comp frame, Premiere frame at playhead, Photoshop document, or Illustrator artboard — returned as an image for a quick visual self-check. |

## Community catalog gateway (4)

| Tool | What it does |
|---|---|
| `adobe_catalog_search` | Search ~550 extra tools from the bundled community Adobe MCPs (ae1/ae2 After Effects, pr1 Premiere 280 tools, ps1 Photoshop 128 tools incl. Firefly generative AI, ai1 Illustrator 66 tools). Use when no native tool fits; then adobe_catalog_describe → adobe_catalog_call. |
| `adobe_catalog_describe` | Full description and input JSON schema of a catalog tool (name like "ps1__photoshop_generative_fill"). |
| `adobe_catalog_call` | Call a catalog tool from a bundled community MCP with its arguments: {tool:"pr1__add_transition", arguments:{...}}. |
| `adobe_catalog_libraries` | Status of the bundled community MCP libraries (installed/built, tool counts, setup notes); refresh:true reconnects and rebuilds the catalog. |

## Bundled community MCPs (catalog)

| id | Library | Notes |
|---|---|---|
| ae1 | [after-effects-mcp (Dakkshin)](https://github.com/Dakkshin/after-effects-mcp) | Needs its bridge panel open in AE: Window > mcp-bridge-auto.jsx (installed by setup). |
| ae2 | [mcp-aftereffects (kumo.productions)](https://github.com/kumoproductions/mcp-aftereffects) | Atomic undo-grouped ops, JSON project export/import, frame rendering — no panel needed. |
| pr1 | [Adobe_Premiere_Pro_MCP (hetpatel-11)](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP) | 280 Premiere tools. Needs its "MCP Bridge (CEP)" panel started in Premiere (Window > Extensions). |
| ps1 | [photoshop-mcp (alisaitteke)](https://github.com/alisaitteke/photoshop-mcp) | 128 Photoshop tools incl. Firefly generative fill/expand/remove, recipes, neural filters. |
| ai1 | [illustrator-mcp-server (ie3jp)](https://github.com/ie3jp/illustrator-mcp-server) | 66 Illustrator tools: read/structure, design tokens, preflight, print, datasets, export. |
