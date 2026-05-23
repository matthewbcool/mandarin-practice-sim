import { useEffect, useRef } from "react";
import * as THREE from "three";
import { SparkRenderer, SplatMesh, type SparkRendererOptions } from "@sparkjsdev/spark";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { describeOrder, drinks, iceLevels, orderTotal, sizes, sweetnessLevels, toppings } from "../game/menu";
import { cartTotal, type KioskAction, type KioskLanguage, type KioskViewModel } from "../game/kiosk";
import type { GamePhase, MenuOption, Order, Receipt } from "../game/types";

export type FocusTarget = "cashier" | "line" | "kiosk" | "receipt" | "none";
export type SceneExperience = "cashier" | "kiosk";
export interface SceneLoadProgress {
  scenarioId: string;
  progress: number;
  status: string;
  ready: boolean;
}
export interface CashierPoseTuning {
  rootY: number;
  rootZ: number;
  scale: number;
  shoulderSpread: number;
  shoulderDrop: number;
  shoulderBack: number;
  upperArmDown: number;
  upperArmForward: number;
  upperArmTwist: number;
  elbowBend: number;
  elbowDrop: number;
  elbowBack: number;
  wristRelax: number;
  shoulderX: number;
  shoulderY: number;
  shoulderZ: number;
  elbowX: number;
  elbowY: number;
  elbowZ: number;
  shoulderRotX: number;
  shoulderRotY: number;
  shoulderRotZ: number;
  upperArmRotX: number;
  upperArmRotY: number;
  upperArmRotZ: number;
  elbowRotX: number;
  elbowRotY: number;
  elbowRotZ: number;
  wristRotZ: number;
}

interface BobaSceneProps {
  scenarioId: string;
  phase: GamePhase;
  experience: SceneExperience;
  listening: boolean;
  npcSpeaking: boolean;
  npcLine: string;
  playerSpeechLabel: string;
  playerSpeechText: string;
  pressure: number;
  currentOrder: Order;
  receipt?: Receipt;
  cashierPose: CashierPoseTuning;
  kioskOpen: boolean;
  kioskView: KioskViewModel;
  onFocusTargetChange: (target: FocusTarget) => void;
  onReceiptAdvance?: () => void;
  onKioskAction?: (action: KioskAction) => void;
  onCashierBreak?: () => void;
  loadingActive: boolean;
  loadingTitle: string;
  loadingStatus: string;
  loadingProgress: number;
  loadingReady: boolean;
  onLoadingEnter?: () => void;
  onSceneLoadProgress?: (progress: SceneLoadProgress) => void;
}

const WORLD_URL = "/assets/world/cozy-boba-shop.spz";
const COLLIDER_URL = "/assets/world/cozy-anime-boba-shop-collider.glb";
const CASHIER_URL = "/assets/characters/aki/aki-cashier.glb";
const CUSTOMER_URL = "/assets/characters/universal-base/Superhero_Male_FullBody.gltf";
const CASHIER_POS: [number, number, number] = [0, 0.097, -2];
const CASHIER_SCALE = 0.99;
const RECEIPT_GAZE_FOCUS_SECONDS = 0.9;
type LoadStage = "world" | "cashier" | "collider" | "firstFrame";
const sceneLoadWeights: Record<LoadStage, number> = {
  world: 0.6,
  cashier: 0.15,
  collider: 0.1,
  firstFrame: 0.15,
};
export const DEFAULT_CASHIER_POSE: CashierPoseTuning = {
  rootY: 0,
  rootZ: 0,
  scale: CASHIER_SCALE,
  shoulderSpread: 0,
  shoulderDrop: 0,
  shoulderBack: 0,
  upperArmDown: 0,
  upperArmForward: 0,
  upperArmTwist: 0,
  elbowBend: 0,
  elbowDrop: 0,
  elbowBack: 0,
  wristRelax: 0,
  shoulderX: 0,
  shoulderY: 0,
  shoulderZ: 0,
  elbowX: 0,
  elbowY: 0,
  elbowZ: 0,
  shoulderRotX: 0,
  shoulderRotY: 0,
  shoulderRotZ: 0,
  upperArmRotX: 0,
  upperArmRotY: 0,
  upperArmRotZ: 1.57,
  elbowRotX: 0,
  elbowRotY: 0,
  elbowRotZ: 0,
  wristRotZ: 0,
};

export const COUNTER_CASHIER_POSE: CashierPoseTuning = {
  ...DEFAULT_CASHIER_POSE,
  rootY: 0.018,
  rootZ: 0.035,
  scale: 1.04,
  shoulderSpread: 0.062,
  shoulderDrop: 0.064,
  shoulderBack: 0.031,
  upperArmDown: 0.64,
  upperArmForward: -0.08,
  upperArmTwist: 0.08,
  elbowBend: 0.36,
  elbowDrop: -0.012,
  elbowBack: -0.04,
  wristRelax: 0.035,
};

export default function BobaScene(props: BobaSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x201714);

    const debug = getDebugParams();
    let disposed = false;
    let loadStatus = "Preparing Boba Tea Shop...";
    const loadStages: Record<LoadStage, number> = {
      world: 0,
      cashier: debug.bare ? 1 : 0,
      collider: debug.bare ? 1 : 0,
      firstFrame: 0,
    };
    const warmupTimers: number[] = [];
    const reportSceneLoad = () => {
      if (disposed) return;
      const progress = (Object.keys(sceneLoadWeights) as LoadStage[]).reduce((sum, stage) => {
        return sum + loadStages[stage] * sceneLoadWeights[stage];
      }, 0);
      const ready = progress >= 0.999;
      propsRef.current.onSceneLoadProgress?.({
        scenarioId: propsRef.current.scenarioId,
        progress: THREE.MathUtils.clamp(progress, 0, 1),
        status: ready ? "Ready" : loadStatus,
        ready,
      });
    };
    const setLoadStage = (stage: LoadStage, value: number, status?: string) => {
      if (disposed) return;
      const nextValue = THREE.MathUtils.clamp(value, 0, 1);
      const nextStatus = status ?? loadStatus;
      if (nextValue <= loadStages[stage] + 0.002 && nextStatus === loadStatus) return;
      loadStages[stage] = Math.max(loadStages[stage], nextValue);
      loadStatus = nextStatus;
      reportSceneLoad();
    };
    const warmStageTo = (stage: LoadStage, cap: number, status: string, durationMs: number) => {
      const start = performance.now();
      const timer = window.setInterval(() => {
        if (disposed || loadStages[stage] >= 1) {
          window.clearInterval(timer);
          return;
        }
        const elapsedRatio = THREE.MathUtils.clamp((performance.now() - start) / durationMs, 0, 1);
        const eased = 1 - (1 - elapsedRatio) * (1 - elapsedRatio);
        setLoadStage(stage, cap * eased, status);
      }, 180);
      warmupTimers.push(timer);
    };
    const progressFromEvent = (event: ProgressEvent<EventTarget>, cap: number, fallback: number) => {
      if (event.lengthComputable && event.total > 0) return Math.min(cap, event.loaded / event.total);
      return fallback;
    };
    reportSceneLoad();

    const camera = new THREE.PerspectiveCamera(debug.fov, mount.clientWidth / mount.clientHeight, 0.02, 80);
    camera.position.set(debug.camera[0], debug.camera[1], debug.camera[2]);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setPixelRatio(debug.pixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = !debug.noXr;
    if (!debug.noXr) renderer.xr.setFramebufferScaleFactor(debug.xrFramebufferScale);
    mount.appendChild(renderer.domElement);

    const vrButton = debug.noXr ? undefined : VRButton.createButton(renderer);
    vrButton?.classList.add("vr-button");
    if (vrButton) document.body.appendChild(vrButton);

    const lookControls = createFirstPersonLookControls(camera, renderer.domElement, new THREE.Vector3(...debug.target));

    const hemi = new THREE.HemisphereLight(0xfff6df, 0x443022, 1.75);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe2b8, 2.2);
    key.position.set(1.5, 3.5, 1.5);
    scene.add(key);

    const sparkOptions: SparkRendererOptions = {
      renderer,
      enableLod: debug.lodEnabled,
      lodRenderScale: debug.lodRenderScale,
      maxStdDev: debug.sparkMaxStdDev,
    };
    if (debug.lodSplatCount) sparkOptions.lodSplatCount = debug.lodSplatCount;
    const spark = new SparkRenderer(sparkOptions);
    spark.frustumCulled = false;
    scene.add(spark);

    const splat = debug.simpleSplat
      ? new SplatMesh({})
      : new SplatMesh({
          url: WORLD_URL,
          lod: debug.lodEnabled,
          enableLod: debug.lodEnabled,
          lodScale: debug.splatLodScale,
          onProgress: (event) => setLoadStage("world", progressFromEvent(event, 0.94, 0.4), "Loading Boba Tea Shop..."),
          onLoad: () => setLoadStage("world", 0.97, "Initializing world..."),
        });
    if (debug.flipSplat) splat.quaternion.set(1, 0, 0, 0);
    splat.position.set(debug.splat[0], debug.splat[1], debug.splat[2]);
    splat.scale.setScalar(debug.splatScale);
    splat.frustumCulled = false;
    if (debug.simpleSplat) {
      const center = new THREE.Vector3();
      const scales = new THREE.Vector3(0.08, 0.08, 0.08);
      const quat = new THREE.Quaternion(0, 0, 0, 1);
      const color = new THREE.Color(1, 0.1, 0.05);
      for (let index = 0; index < 800; index += 1) {
        center.set((Math.random() - 0.5) * 1.2, 1.45 + (Math.random() - 0.5) * 0.7, -1.2 + (Math.random() - 0.5) * 0.3);
        splat.pushSplat(center, scales, quat, 1, color);
      }
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xffd58d }));
      box.position.set(0, 1.45, -1.4);
      scene.add(box);
      setLoadStage("world", 1, "World ready");
    } else {
      warmStageTo("world", 0.92, "Loading Boba Tea Shop...", 12000);
      void splat.initialized
        .then(() => setLoadStage("world", 1, "World ready"))
        .catch((error) => {
          console.warn("World splat failed to initialize.", error);
          setLoadStage("world", 1, "World unavailable; continuing.");
        });
    }
    scene.add(splat);

    const focusObjects: THREE.Object3D[] = [];
    const animatedCharacters: THREE.Object3D[] = [];
    let cashierRoot: THREE.Object3D | undefined;
    let cashierDefaultRotationY = 0;
    let cashierBlink: CashierBlinkController | undefined;
    let lastFocusTarget: FocusTarget = "none";

    const menuGroup = createMenuBoards();
    menuGroup.position.set(0.13, 1.915, -2.08);
    if (!debug.bare) scene.add(menuGroup);

    const drink = createDrinkPreview();
    drink.position.set(0.58, 0.86, -0.88);
    drink.visible = false;
    scene.add(drink);

    const receiptDisplay = createReceiptDisplay();
    scene.add(receiptDisplay.group);
    focusObjects.push(receiptDisplay.hitArea);

    const kiosk = createKioskTablet();
    scene.add(kiosk.group);
    focusObjects.push(kiosk.screenMesh, kiosk.hitArea);

    const confetti = createConfettiBurst();
    scene.add(confetti.group);

    const exclamation = createTextSprite("！");
    exclamation.position.set(0, 1.72, -1.42);
    exclamation.visible = false;
    scene.add(exclamation);

    const npcBubble = createDynamicPanelSprite({
      width: 1024,
      height: 260,
      title: "店員",
      accent: "#b8c98f",
      background: "rgba(48, 45, 24, 0.84)",
      textColor: "#fff5d8",
      titleFont: "800 34px system-ui, sans-serif",
      bodyFont: "850 54px system-ui, sans-serif",
      bodyTop: 96,
      lineHeight: 62,
      maxLines: 2,
    });
    npcBubble.sprite.position.set(-0.32, 1.1, -0.94);
    npcBubble.sprite.scale.set(0.54, 0.14, 1);
    npcBubble.sprite.visible = false;
    scene.add(npcBubble.sprite);

    const orderPanel = createDynamicPanelSprite({
      width: 760,
      height: 230,
      title: "目前聽到",
      accent: "#9fb88f",
      background: "rgba(48, 45, 24, 0.74)",
      textColor: "#fff5d8",
      titleFont: "800 30px system-ui, sans-serif",
      bodyFont: "850 43px system-ui, sans-serif",
      bodyTop: 90,
      lineHeight: 50,
      maxLines: 2,
    });
    orderPanel.sprite.position.set(0.56, 0.98, -0.72);
    orderPanel.sprite.scale.set(0.31, 0.095, 1);
    orderPanel.sprite.visible = false;
    scene.add(orderPanel.sprite);

    const pressurePanel = createDynamicPanelSprite({
      width: 600,
      height: 190,
      title: "後方",
      accent: "#bd7659",
      background: "rgba(48, 45, 24, 0.7)",
      textColor: "#fff5d8",
      titleFont: "800 28px system-ui, sans-serif",
      bodyFont: "850 40px system-ui, sans-serif",
      bodyTop: 82,
      lineHeight: 46,
      maxLines: 1,
    });
    pressurePanel.sprite.position.set(-0.56, 0.98, -0.72);
    pressurePanel.sprite.scale.set(0.26, 0.082, 1);
    pressurePanel.sprite.visible = false;
    scene.add(pressurePanel.sprite);

    const speechPanel = createDynamicPanelSprite({
      width: 900,
      height: 190,
      title: "玩家語音",
      accent: "#f1e7c8",
      background: "rgba(48, 45, 24, 0.72)",
      textColor: "#fff5d8",
      titleFont: "800 28px system-ui, sans-serif",
      bodyFont: "850 42px system-ui, sans-serif",
      bodyTop: 82,
      lineHeight: 48,
      maxLines: 2,
    });
    speechPanel.sprite.position.set(0, 0.72, -0.72);
    speechPanel.sprite.scale.set(0.44, 0.093, 1);
    speechPanel.sprite.visible = false;
    scene.add(speechPanel.sprite);

    const loadingPanel = createLoadingPanelSprite();
    loadingPanel.sprite.visible = false;
    scene.add(loadingPanel.sprite);

    const loader = new GLTFLoader();
    if (!debug.bare) {
      warmStageTo("cashier", 0.82, "Loading cashier...", 7000);
      loader.load(
        CASHIER_URL,
        (gltf) => {
          if (disposed) return;
          cashierRoot = gltf.scene;
          cashierRoot.name = "cashier";
          applyCashierRootPose(cashierRoot, propsRef.current.cashierPose);
          cashierRoot.rotation.y = 0;
          cashierDefaultRotationY = cashierRoot.rotation.y;
          cashierRoot.traverse((child) => {
            child.userData.focusTarget = "cashier";
            if ((child as THREE.Mesh).isMesh) {
              focusObjects.push(child);
              const material = (child as THREE.Mesh).material;
              if (Array.isArray(material)) material.forEach(softenMaterial);
              else softenMaterial(material);
            }
          });
          poseCashierAvatar(cashierRoot, propsRef.current.cashierPose);
          cashierBlink = createCashierBlinkController(cashierRoot);
          scene.add(cashierRoot);
          animatedCharacters.push(cashierRoot);
          setLoadStage("cashier", 1, "Cashier ready");
        },
        (event) => setLoadStage("cashier", progressFromEvent(event, 0.9, 0.5), "Loading cashier..."),
        (error) => {
          if (disposed) return;
          console.warn("Cashier avatar failed to load; using fallback.", error);
          cashierRoot = createFallbackCharacter(0xffc3a5);
          applyCashierRootPose(cashierRoot, propsRef.current.cashierPose);
          cashierRoot.rotation.y = Math.PI;
          cashierDefaultRotationY = cashierRoot.rotation.y;
          cashierRoot.userData.focusTarget = "cashier";
          focusObjects.push(cashierRoot);
          scene.add(cashierRoot);
          animatedCharacters.push(cashierRoot);
          setLoadStage("cashier", 1, "Cashier ready");
        },
      );
    }

    if (!debug.bare && debug.gltfCharacters) loader.load(
      CUSTOMER_URL,
      (gltf) => {
        const spots = [
          [-0.65, 0.02, 1.25, 0.15],
          [0.08, 0.02, 1.75, -0.08],
          [0.72, 0.02, 1.32, -0.22],
        ] as const;
        spots.forEach(([x, y, z, rot], index) => {
          const customer = gltf.scene.clone(true);
          customer.position.set(x, y, z);
          customer.rotation.y = rot;
          customer.scale.setScalar(index === 1 ? 0.74 : 0.68);
          customer.userData.focusTarget = "line";
          customer.traverse((child) => {
            child.userData.focusTarget = "line";
            if ((child as THREE.Mesh).isMesh) focusObjects.push(child);
          });
          scene.add(customer);
          animatedCharacters.push(customer);

          const bubble = createTextSprite(index === 0 ? "快一點啦..." : index === 1 ? "還沒好嗎？" : "嗯...");
          bubble.position.set(x, 1.95, z - 0.18);
          bubble.scale.setScalar(0.48);
          scene.add(bubble);
        });
      },
      undefined,
      () => {
        [-0.65, 0.08, 0.72].forEach((x, index) => {
          const customer = createFallbackCharacter(0x9cc6ff);
          customer.position.set(x, 0.02, index === 1 ? 1.75 : 1.25);
          customer.userData.focusTarget = "line";
          focusObjects.push(customer);
          scene.add(customer);
          animatedCharacters.push(customer);
        });
      },
    );

    if (!debug.bare && !debug.gltfCharacters) {
      [
        [-0.65, 0.02, 1.25, 0.15],
        [0.08, 0.02, 1.75, -0.08],
        [0.72, 0.02, 1.32, -0.22],
      ].forEach(([x, y, z, rot], index) => {
        const customer = createFallbackCharacter(index === 1 ? 0xd4b3ff : 0x9cc6ff);
        customer.position.set(x, y, z);
        customer.rotation.y = rot;
        customer.scale.setScalar(index === 1 ? 0.86 : 0.78);
        customer.userData.focusTarget = "line";
        customer.traverse((child) => {
          child.userData.focusTarget = "line";
          if ((child as THREE.Mesh).isMesh) focusObjects.push(child);
        });
        scene.add(customer);
        animatedCharacters.push(customer);

        const bubble = createTextSprite(index === 0 ? "快一點啦..." : index === 1 ? "還沒好嗎？" : "嗯...");
        bubble.position.set(x, 1.95, z - 0.18);
        bubble.scale.setScalar(0.48);
        bubble.visible = false;
        bubble.userData.pressureBubble = true;
        scene.add(bubble);
      });
    }

    if (!debug.bare) {
      warmStageTo("collider", 0.76, "Preparing movement...", 5000);
      loader.load(
        COLLIDER_URL,
        (gltf) => {
          if (disposed) return;
          gltf.scene.visible = false;
          gltf.scene.name = "world-collider";
          scene.add(gltf.scene);
          setLoadStage("collider", 1, "Movement ready");
        },
        (event) => setLoadStage("collider", progressFromEvent(event, 0.9, 0.5), "Preparing movement..."),
        (error) => {
          console.warn("World collider failed to load; continuing without collider.", error);
          setLoadStage("collider", 1, "Movement ready");
        },
      );
    }

    const raycaster = new THREE.Raycaster();
    const center = new THREE.Vector2(0, 0);
    const clock = new THREE.Clock();
    let lastNpcText = "";
    let lastOrderText = "";
    let lastOrderTitle = "";
    let lastPressureText = "";
    let lastSpeechText = "";
    let lastSpeechTitle = "";
    let lastReceiptId = "";
    let lastDrinkVisualKey = "";
    let wasCelebrating = false;
    let receiptFocused = false;
    let receiptGazeStartedAt = -1;
    let receiptFocusAmount = 0;
    const counterDrinkPosition = new THREE.Vector3(0.58, 0.86, -0.88);
    const celebrationDrinkPosition = new THREE.Vector3(0, 1.05, -0.8);
    const receiptDrinkPosition = new THREE.Vector3(0.05, 1.04, -0.9);
    const receiptSidePosition = new THREE.Vector3(0.46, 1.18, -0.78);
    const receiptFocusedPosition = new THREE.Vector3();
    const receiptForward = new THREE.Vector3();
    const receiptSideQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.16, 0.018));
    const homeCameraPosition = new THREE.Vector3(debug.camera[0], debug.camera[1], debug.camera[2]);
    const homeTarget = new THREE.Vector3(...debug.target);
    const kioskCameraPosition = new THREE.Vector3(0.08, 1.4, -0.42);
    const kioskCameraTarget = new THREE.Vector3(0.12, 1.42, -1.22);
    const xrControllerRayOrigin = new THREE.Vector3();
    const xrControllerRayDirection = new THREE.Vector3();
    const xrControllerMatrix = new THREE.Matrix4();
    const loadingPanelForward = new THREE.Vector3();
    const loadingPanelPosition = new THREE.Vector3();
    let wasKioskOpen = false;
    let lastKioskRenderKey = "";
    let lastLoadingPanelKey = "";
    let firstSceneFrameSettled = false;

    const onResize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", onResize);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && propsRef.current.experience === "kiosk" && propsRef.current.kioskOpen) {
        event.preventDefault();
        propsRef.current.onKioskAction?.({ type: "close" });
        return;
      }
      if (event.key.toLowerCase() === "r") {
        camera.position.set(debug.camera[0], debug.camera[1], debug.camera[2]);
        lookControls.reset(new THREE.Vector3(...debug.target));
      }
    };
    window.addEventListener("keydown", onKeyDown);

    const pointer = new THREE.Vector2();
    let pointerDownX = 0;
    let pointerDownY = 0;
    const handleSelectionFromRaycaster = () => {
      const state = propsRef.current;
      if (state.loadingActive) {
        if (state.loadingReady) state.onLoadingEnter?.();
        return;
      }
      const receiptVisible = state.phase === "receipt" && Boolean(state.receipt);
      const hits = raycaster.intersectObjects(focusObjects, true);
      const hit = hits.find((item) => {
        const focus = item.object.userData.focusTarget as FocusTarget | undefined;
        return focus !== "receipt" || receiptVisible;
      });
      const focus = (hit?.object.userData.focusTarget as FocusTarget | undefined) ?? "none";

      if (state.experience === "kiosk") {
        if (focus === "kiosk" && hit) {
          if (!state.kioskOpen) {
            state.onKioskAction?.({ type: "open" });
            return;
          }
          if (hit.object.userData.kioskScreen) {
            const action = kioskActionFromHit(kiosk, hit);
            if (action) state.onKioskAction?.(action);
          }
          return;
        }
        if (focus === "cashier") {
          state.onCashierBreak?.();
          return;
        }
      }

      if (receiptVisible && (focus === "receipt" || lastFocusTarget === "receipt")) {
        if (!receiptFocused) {
          receiptFocused = true;
          return;
        }
        state.onReceiptAdvance?.();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerDownX = event.clientX;
      pointerDownY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      const distance = Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY);
      if (distance > 10) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -(((event.clientY - bounds.top) / bounds.height) * 2 - 1));
      raycaster.setFromCamera(pointer, camera);
      handleSelectionFromRaycaster();
    };
    const selectFromController = (controller: THREE.Object3D) => {
      xrControllerMatrix.identity().extractRotation(controller.matrixWorld);
      xrControllerRayOrigin.setFromMatrixPosition(controller.matrixWorld);
      xrControllerRayDirection.set(0, 0, -1).applyMatrix4(xrControllerMatrix);
      raycaster.set(xrControllerRayOrigin, xrControllerRayDirection);
      handleSelectionFromRaycaster();
    };
    const controllers = debug.noXr ? [] : [renderer.xr.getController(0), renderer.xr.getController(1)];
    const controllerSelectHandlers: Array<{ controller: ReturnType<typeof renderer.xr.getController>; handler: () => void }> = [];
    controllers.forEach((controller) => {
      const handler = () => selectFromController(controller);
      controllerSelectHandlers.push({ controller, handler });
      controller.add(createControllerRay());
      controller.addEventListener("selectend", handler);
      scene.add(controller);
    });
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    renderer.setAnimationLoop(() => {
      const elapsed = clock.getElapsedTime();
      const state = propsRef.current;
      const kioskMode = state.experience === "kiosk";
      const receiptVisible = state.phase === "receipt" && Boolean(state.receipt);
      const kioskReceiptOrder = kioskMode ? state.kioskView.receipt?.items[0]?.order : undefined;
      const kioskReceiptVisible = Boolean(kioskReceiptOrder);
      const presentingXr = renderer.xr.isPresenting;
      const loadingActive = state.loadingActive;
      receiptDisplay.hitArea.visible = receiptVisible && !loadingActive;
      kiosk.group.visible = kioskMode;
      kiosk.hitArea.visible = kioskMode && !loadingActive;
      const kioskRenderKey = buildKioskRenderKey(state.kioskOpen, state.kioskView);
      if (kioskMode && kioskRenderKey !== lastKioskRenderKey) {
        lastKioskRenderKey = kioskRenderKey;
        kiosk.update(state.kioskView, state.kioskOpen);
      }

      loadingPanel.sprite.visible = loadingActive && presentingXr;
      if (loadingPanel.sprite.visible) {
        const panelKey = `${state.loadingTitle}|${state.loadingStatus}|${state.loadingProgress}|${state.loadingReady}`;
        if (panelKey !== lastLoadingPanelKey) {
          lastLoadingPanelKey = panelKey;
          loadingPanel.update(state.loadingTitle, state.loadingStatus, state.loadingProgress, state.loadingReady);
        }
        const viewCamera = renderer.xr.getCamera();
        viewCamera.updateMatrixWorld();
        viewCamera.getWorldDirection(loadingPanelForward);
        loadingPanelPosition.setFromMatrixPosition(viewCamera.matrixWorld).addScaledVector(loadingPanelForward, 1.45);
        loadingPanelPosition.y -= 0.08;
        loadingPanel.sprite.position.copy(loadingPanelPosition);
        loadingPanel.sprite.scale.set(0.9, 0.45, 1);
      }

      if (presentingXr) {
        lookControls.setEnabled(false);
        wasKioskOpen = false;
      } else if (kioskMode && state.kioskOpen) {
        lookControls.setEnabled(false);
        camera.position.lerp(kioskCameraPosition, 0.16);
        camera.fov = THREE.MathUtils.lerp(camera.fov, 52, 0.12);
        camera.updateProjectionMatrix();
        camera.lookAt(kioskCameraTarget);
        wasKioskOpen = true;
      } else {
        if (wasKioskOpen) {
          lookControls.reset(homeTarget);
          wasKioskOpen = false;
        }
        lookControls.setEnabled(true);
        if (kioskMode) camera.position.lerp(homeCameraPosition, 0.08);
        camera.fov = THREE.MathUtils.lerp(camera.fov, debug.fov, 0.12);
        camera.updateProjectionMatrix();
        lookControls.update();
      }

      raycaster.setFromCamera(center, camera);
      const intersects = raycaster.intersectObjects(focusObjects, true);
      const focusHit = intersects.find((hit) => {
        const focus = hit.object.userData.focusTarget as FocusTarget | undefined;
        if (focus === "kiosk" && !kioskMode) return false;
        return focus !== "receipt" || receiptVisible;
      });
      const target = loadingActive ? "none" : (focusHit?.object.userData.focusTarget as FocusTarget | undefined) ?? "none";
      if (target !== lastFocusTarget) {
        lastFocusTarget = target;
        propsRef.current.onFocusTargetChange(target);
      }

      const receiptId = receiptVisible ? state.receipt?.id ?? "" : "";
      if (receiptId !== lastReceiptId) {
        lastReceiptId = receiptId;
        receiptFocused = false;
        receiptGazeStartedAt = -1;
        receiptFocusAmount = 0;
        if (state.receipt) receiptDisplay.update(state.receipt);
      }
      if (!receiptVisible) {
        receiptFocused = false;
        receiptGazeStartedAt = -1;
      } else if (!receiptFocused && target === "receipt") {
        if (receiptGazeStartedAt < 0) receiptGazeStartedAt = elapsed;
        if (elapsed - receiptGazeStartedAt >= RECEIPT_GAZE_FOCUS_SECONDS) {
          receiptFocused = true;
        }
      } else if (target !== "receipt") {
        receiptGazeStartedAt = -1;
      }
      receiptFocusAmount = THREE.MathUtils.lerp(receiptFocusAmount, receiptFocused ? 1 : 0, 0.08);

      if (cashierRoot) {
        const speakingBob = state.npcSpeaking ? Math.sin(elapsed * 18) * 0.012 : Math.sin(elapsed * 2.3) * 0.006;
        applyCashierRootPose(cashierRoot, state.cashierPose, speakingBob);
        if (state.experience === "kiosk") {
          cashierRoot.position.x -= 0.68;
          cashierRoot.position.z += 0.24;
          cashierRoot.rotation.y = -0.28;
          cashierRoot.rotation.z = Math.sin(elapsed * 1.1) * 0.007;
        } else {
          cashierRoot.rotation.y = cashierDefaultRotationY;
          cashierRoot.rotation.z = Math.sin(elapsed * 1.4) * 0.012;
        }
        poseCashierAvatar(cashierRoot, state.cashierPose);
        cashierBlink?.update(elapsed);
      }

      animatedCharacters.forEach((character, index) => {
        if (character === cashierRoot) return;
        character.position.y = 0.02 + Math.sin(elapsed * 1.5 + index) * 0.006;
        character.rotation.z = Math.sin(elapsed * 1.2 + index) * 0.01;
      });

      exclamation.visible = !loadingActive && state.experience === "cashier" && target === "cashier" && state.listening;
      exclamation.scale.setScalar(0.34 + Math.sin(elapsed * 7) * 0.03);
      const celebrating = state.phase === "serving";
      if (celebrating && !wasCelebrating) confetti.start(elapsed);
      wasCelebrating = celebrating;
      confetti.update(elapsed);

      const drinkVisible = !loadingActive && (celebrating || receiptVisible || kioskReceiptVisible);
      const drinkOrder = state.receipt?.recognized ?? kioskReceiptOrder ?? state.currentOrder;
      const drinkVisualKey = buildDrinkVisualKey(drinkOrder);
      if (drinkVisualKey !== lastDrinkVisualKey) {
        lastDrinkVisualKey = drinkVisualKey;
        updateDrinkPreview(drink, drinkOrder);
      }
      const drinkOpacity = receiptVisible ? 1 - receiptFocusAmount : 1;
      drink.visible = drinkVisible && drinkOpacity > 0.03;
      const targetDrinkPosition = celebrating ? celebrationDrinkPosition : receiptVisible || kioskReceiptVisible ? receiptDrinkPosition : counterDrinkPosition;
      drink.position.lerp(targetDrinkPosition, 0.22);
      const receiptDrinkScale = THREE.MathUtils.lerp(1.08, 0.72, receiptFocusAmount);
      drink.scale.setScalar(celebrating ? 1.38 + Math.sin(elapsed * 5.5) * 0.026 : receiptVisible || kioskReceiptVisible ? receiptDrinkScale : 1);
      drink.rotation.y = celebrating ? elapsed * 1.6 : receiptVisible || kioskReceiptVisible ? Math.sin(elapsed * 1.2) * 0.08 : Math.sin(elapsed * 1.2) * 0.16;
      drink.rotation.z = celebrating ? Math.sin(elapsed * 4.2) * 0.035 : 0;
      setObjectOpacity(drink, drinkOpacity);

      receiptDisplay.group.visible = receiptVisible && !loadingActive;
      if (receiptVisible) {
        camera.getWorldDirection(receiptForward);
        receiptFocusedPosition.copy(camera.position).addScaledVector(receiptForward, 0.82);
        receiptDisplay.group.position.lerpVectors(receiptSidePosition, receiptFocusedPosition, receiptFocusAmount);
        const gazeProgress =
          !receiptFocused && target === "receipt" && receiptGazeStartedAt >= 0
            ? THREE.MathUtils.clamp((elapsed - receiptGazeStartedAt) / RECEIPT_GAZE_FOCUS_SECONDS, 0, 1)
            : 0;
        const receiptScale = THREE.MathUtils.lerp(0.76, 1.14, receiptFocusAmount) + gazeProgress * 0.025;
        receiptDisplay.group.scale.setScalar(receiptScale);
        receiptDisplay.group.quaternion.slerpQuaternions(receiptSideQuaternion, camera.quaternion, receiptFocusAmount);
        receiptDisplay.setOpacity(THREE.MathUtils.lerp(0.92, 1, Math.max(receiptFocusAmount, gazeProgress)));
      }

      const showCashierPanels = !loadingActive && state.experience === "cashier" && ["ordering", "confirming", "paying", "serving"].includes(state.phase);
      const showKioskSubtitle = !loadingActive && state.experience === "kiosk" && state.phase === "kiosk";
      npcBubble.sprite.visible = showCashierPanels && Boolean(state.npcLine);
      if (npcBubble.sprite.visible && state.npcLine !== lastNpcText) {
        lastNpcText = state.npcLine;
        npcBubble.update(state.npcLine);
      }

      const orderText = describeOrder(state.currentOrder);
      const orderTitle = state.phase === "confirming" ? "確認中" : "目前聽到";
      orderPanel.sprite.visible = showCashierPanels && state.phase !== "serving" && hasOrderContent(state.currentOrder);
      if (orderPanel.sprite.visible && (orderText !== lastOrderText || orderTitle !== lastOrderTitle)) {
        lastOrderText = orderText;
        lastOrderTitle = orderTitle;
        orderPanel.update(orderText, orderTitle);
      }

      const pressureText = `耐心 ${Math.max(0, 100 - state.pressure)}%`;
      pressurePanel.sprite.visible = showCashierPanels && state.pressure > 14;
      if (pressurePanel.sprite.visible && pressureText !== lastPressureText) {
        lastPressureText = pressureText;
        pressurePanel.update(pressureText);
      }

      const speechText = state.playerSpeechText || (state.listening ? "請說話，我正在聽。" : "");
      const speechTitle = state.listening ? "正在聽" : state.playerSpeechLabel || "聽到";
      speechPanel.sprite.visible = ((showCashierPanels && state.phase !== "serving") || showKioskSubtitle) && Boolean(speechText);
      if (speechPanel.sprite.visible && (speechText !== lastSpeechText || speechTitle !== lastSpeechTitle)) {
        lastSpeechText = speechText;
        lastSpeechTitle = speechTitle;
        speechPanel.update(speechText, speechTitle);
      }

      scene.traverse((object) => {
        if (object.userData.pressureBubble) {
          object.visible = state.phase === "confirming" || state.phase === "paying";
        }
      });

      renderer.render(scene, camera);
      if (!firstSceneFrameSettled && loadStages.world >= 1 && loadStages.cashier >= 1 && loadStages.collider >= 1) {
        firstSceneFrameSettled = true;
        setLoadStage("firstFrame", 1, "Ready");
      }
    });

    (window as typeof window & { __bobaScene?: unknown }).__bobaScene = {
      scene,
      camera,
      controls: lookControls,
      splat,
      renderer,
      spark,
      menuGroup,
    };

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      warmupTimers.forEach((timer) => window.clearInterval(timer));
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controllerSelectHandlers.forEach(({ controller, handler }) => {
        controller.removeEventListener("selectend", handler);
        controller.traverse((object) => {
          const mesh = object as THREE.Mesh | THREE.Line;
          mesh.geometry?.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material?.dispose?.();
        });
        scene.remove(controller);
      });
      lookControls.dispose();
      confetti.dispose();
      receiptDisplay.dispose();
      kiosk.dispose();
      loadingPanel.dispose();
      renderer.dispose();
      vrButton?.remove();
      mount.removeChild(renderer.domElement);
      delete (window as typeof window & { __bobaScene?: unknown }).__bobaScene;
    };
  }, []);

  return <div ref={mountRef} className="scene-canvas" />;
}

interface KioskButton {
  x: number;
  y: number;
  width: number;
  height: number;
  action: KioskAction;
}

interface KioskTablet {
  group: THREE.Group;
  screenMesh: THREE.Mesh;
  hitArea: THREE.Mesh;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  buttons: KioskButton[];
  update: (view: KioskViewModel, open: boolean) => void;
  dispose: () => void;
}

const kioskScreenWidth = 0.98;
const kioskScreenHeight = 0.62;

function createKioskTablet(): KioskTablet {
  const group = new THREE.Group();
  group.position.set(0.12, 1.42, -1.22);
  group.rotation.x = -0.08;
  group.scale.setScalar(0.72);
  group.userData.focusTarget = "kiosk";

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x262119,
    roughness: 0.72,
    metalness: 0.18,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0x9fb88f,
    roughness: 0.66,
    metalness: 0.06,
  });
  const standMaterial = new THREE.MeshStandardMaterial({
    color: 0x574331,
    roughness: 0.76,
    metalness: 0.08,
  });

  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.72, 0.05), frameMaterial);
  frame.userData.focusTarget = "kiosk";
  group.add(frame);

  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.78, 0.018), trimMaterial);
  trim.position.z = -0.018;
  trim.userData.focusTarget = "kiosk";
  group.add(trim);

  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.17, 0.08), standMaterial);
  stand.position.set(0, -0.44, -0.02);
  stand.rotation.x = 0.16;
  stand.userData.focusTarget = "kiosk";
  group.add(stand);

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.24), standMaterial);
  base.position.set(0, -0.56, 0.02);
  base.userData.focusTarget = "kiosk";
  group.add(base);

  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 720;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const screenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(kioskScreenWidth, kioskScreenHeight),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  screenMesh.position.z = 0.033;
  screenMesh.userData.focusTarget = "kiosk";
  screenMesh.userData.kioskScreen = true;
  group.add(screenMesh);

  const hitArea = new THREE.Mesh(
    new THREE.PlaneGeometry(1.02, 0.66),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.001,
      depthWrite: false,
    }),
  );
  hitArea.position.z = 0.041;
  hitArea.userData.focusTarget = "kiosk";
  hitArea.userData.kioskScreen = true;
  group.add(hitArea);

  const tablet: KioskTablet = {
    group,
    screenMesh,
    hitArea,
    canvas,
    texture,
    buttons: [],
    update(view, open) {
      this.buttons = drawKioskScreen(canvas.getContext("2d")!, view, open);
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
      [frameMaterial, trimMaterial, standMaterial].forEach((material) => material.dispose());
      group.traverse((object) => {
        if ((object as THREE.Mesh).geometry) (object as THREE.Mesh).geometry.dispose();
        const material = (object as THREE.Mesh).material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose?.();
      });
    },
  };

  tablet.update(
    {
      screen: "drinks",
      language: "en",
      drinkPage: 0,
      selected: { quantity: 1, toppings: [] },
      cart: [],
    },
    false,
  );

  return tablet;
}

function kioskActionFromHit(tablet: KioskTablet, hit: THREE.Intersection): KioskAction | undefined {
  const localPoint = tablet.screenMesh.worldToLocal(hit.point.clone());
  const x = (localPoint.x / kioskScreenWidth + 0.5) * tablet.canvas.width;
  const y = (0.5 - localPoint.y / kioskScreenHeight) * tablet.canvas.height;
  return tablet.buttons.find((button) => x >= button.x && x <= button.x + button.width && y >= button.y && y <= button.y + button.height)?.action;
}

function createControllerRay() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1.8),
  ]);
  const material = new THREE.LineBasicMaterial({
    color: 0xf1e7c8,
    transparent: true,
    opacity: 0.74,
    depthTest: false,
  });
  const ray = new THREE.Line(geometry, material);
  ray.renderOrder = 120;
  return ray;
}

function drawKioskScreen(ctx: CanvasRenderingContext2D, view: KioskViewModel, open: boolean): KioskButton[] {
  const { width, height } = ctx.canvas;
  const buttons: KioskButton[] = [];
  ctx.clearRect(0, 0, width, height);
  drawKioskBackground(ctx);

  if (!open) {
    drawClosedKiosk(ctx, view, buttons);
    return buttons;
  }

  drawKioskHeader(ctx, view, buttons);
  if (view.screen === "customize") drawCustomizeScreen(ctx, view, buttons);
  else if (view.screen === "cart") drawCartScreen(ctx, view, buttons);
  else if (view.screen === "receipt") drawReceiptScreen(ctx, view, buttons);
  else drawDrinkScreen(ctx, view, buttons);
  return buttons;
}

function drawKioskBackground(ctx: CanvasRenderingContext2D) {
  const { width, height } = ctx.canvas;
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#fff5d8");
  bg.addColorStop(0.58, "#f1e7c8");
  bg.addColorStop(1, "#d9caa1");
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, width, height, 18);
  ctx.fill();
  ctx.fillStyle = "rgba(48, 45, 24, 0.05)";
  for (let y = 42; y < height; y += 54) ctx.fillRect(0, y, width, 1);
}

function drawClosedKiosk(ctx: CanvasRenderingContext2D, view: KioskViewModel, buttons: KioskButton[]) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#302d18";
  ctx.font = "900 72px system-ui, sans-serif";
  ctx.fillText(copy("tapToOrder", view.language), 512, 300);
  ctx.fillStyle = "rgba(48, 45, 24, 0.64)";
  ctx.font = "800 34px system-ui, sans-serif";
  ctx.fillText(copy("publicMode", view.language), 512, 368);
  addKioskButton(ctx, buttons, 342, 464, 340, 96, copy("start", view.language), { type: "open" }, { tone: "primary" });
}

function drawKioskHeader(ctx: CanvasRenderingContext2D, view: KioskViewModel, buttons: KioskButton[]) {
  ctx.fillStyle = "rgba(48, 45, 24, 0.88)";
  roundRect(ctx, 22, 20, 980, 86, 18);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff5d8";
  ctx.font = "900 32px system-ui, sans-serif";
  ctx.fillText(copy("title", view.language), 46, 64);

  const total = cartTotal(view.cart);
  ctx.fillStyle = "#b8c98f";
  ctx.font = "850 23px system-ui, sans-serif";
  ctx.fillText(`${copy("cart", view.language)} ${view.cart.length} / ${total} 元`, 276, 64);

  const languages: KioskLanguage[] = ["en", "zh"];
  languages.forEach((language, index) => {
    addKioskButton(ctx, buttons, 706 + index * 90, 34, 76, 46, languageLabel(language), { type: "setLanguage", language }, {
      tone: language === view.language ? "primary" : undefined,
      small: true,
    });
  });
  addKioskButton(ctx, buttons, 884, 28, 94, 58, "X", { type: "close" }, { small: true });
}

function drawDrinkScreen(ctx: CanvasRenderingContext2D, view: KioskViewModel, buttons: KioskButton[]) {
  drawSectionTitle(ctx, copy("chooseDrink", view.language), 52, 144);
  const pageSize = 8;
  const pageCount = Math.ceil(drinks.length / pageSize);
  const page = Math.min(view.drinkPage, pageCount - 1);
  drinks.slice(page * pageSize, page * pageSize + pageSize).forEach((drink, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 52 + col * 462;
    const y = 184 + row * 86;
    addKioskButton(ctx, buttons, x, y, 420, 68, `${optionLabel(drink, view.language)}  ${drink.price ?? 0}元`, { type: "selectDrink", id: drink.id }, { align: "left" });
  });

  addKioskButton(ctx, buttons, 52, 582, 150, 64, copy("previous", view.language), { type: "previousDrinkPage" }, { disabled: page <= 0, tone: "ghost" });
  addKioskButton(ctx, buttons, 224, 582, 170, 64, `${page + 1}/${pageCount}`, { type: "previousDrinkPage" }, { disabled: true, tone: "ghost" });
  addKioskButton(ctx, buttons, 416, 582, 150, 64, copy("next", view.language), { type: "nextDrinkPage" }, { disabled: page >= pageCount - 1, tone: "ghost" });
  addKioskButton(ctx, buttons, 712, 582, 238, 64, copy("viewCart", view.language), { type: "showCart" }, { tone: view.cart.length ? "primary" : "ghost" });
}

function drawCustomizeScreen(ctx: CanvasRenderingContext2D, view: KioskViewModel, buttons: KioskButton[]) {
  const order = view.selected;
  drawSectionTitle(ctx, optionLabel(order.drink ?? drinks[0], view.language), 52, 138);
  ctx.fillStyle = "rgba(48, 45, 24, 0.68)";
  ctx.font = "800 24px system-ui, sans-serif";
  ctx.fillText(`${copy("lineTotal", view.language)} ${orderTotal(order)} 元`, 52, 174);

  drawOptionRow(ctx, buttons, copy("size", view.language), sizes, order.size?.id, view.language, "setSize", 52, 214);
  drawOptionRow(ctx, buttons, copy("sweetness", view.language), sweetnessLevels, order.sweetness?.id, view.language, "setSweetness", 52, 308);
  drawOptionRow(ctx, buttons, copy("ice", view.language), iceLevels, order.ice?.id, view.language, "setIce", 52, 402);

  drawSectionTitle(ctx, copy("toppings", view.language), 52, 514, 24);
  toppings.forEach((topping, index) => {
    const selected = order.toppings.some((item) => item.id === topping.id);
    const col = index % 5;
    const row = Math.floor(index / 5);
    addKioskButton(ctx, buttons, 52 + col * 182, 538 + row * 54, 160, 42, optionLabel(topping, view.language), { type: "toggleTopping", id: topping.id }, {
      tone: selected ? "primary" : "ghost",
      small: true,
    });
  });

  addKioskButton(ctx, buttons, 606, 132, 64, 52, "-", { type: "setQuantity", quantity: Math.max(1, order.quantity - 1) }, { tone: "ghost" });
  ctx.fillStyle = "#302d18";
  ctx.font = "900 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(String(order.quantity), 714, 158);
  addKioskButton(ctx, buttons, 758, 132, 64, 52, "+", { type: "setQuantity", quantity: Math.min(9, order.quantity + 1) }, { tone: "ghost" });
  addKioskButton(ctx, buttons, 52, 648, 170, 52, copy("back", view.language), { type: "back" }, { tone: "ghost" });
  addKioskButton(ctx, buttons, 708, 642, 242, 58, copy("add", view.language), { type: "addToCart" }, { tone: "primary" });
}

function drawOptionRow(
  ctx: CanvasRenderingContext2D,
  buttons: KioskButton[],
  title: string,
  options: MenuOption[],
  selectedId: string | undefined,
  language: KioskLanguage,
  actionType: "setSize" | "setSweetness" | "setIce",
  x: number,
  y: number,
) {
  ctx.fillStyle = "rgba(48, 45, 24, 0.72)";
  ctx.font = "900 24px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, x, y);
  options.forEach((option, index) => {
    const buttonWidth = actionType === "setSize" ? 150 : 158;
    addKioskButton(ctx, buttons, x + index * (buttonWidth + 12), y + 18, buttonWidth, 46, optionLabel(option, language), { type: actionType, id: option.id }, {
      tone: option.id === selectedId ? "primary" : "ghost",
      small: true,
    });
  });
}

function drawCartScreen(ctx: CanvasRenderingContext2D, view: KioskViewModel, buttons: KioskButton[]) {
  drawSectionTitle(ctx, copy("cart", view.language), 52, 144);
  if (!view.cart.length) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(48, 45, 24, 0.62)";
    ctx.font = "850 34px system-ui, sans-serif";
    ctx.fillText(copy("emptyCart", view.language), 512, 330);
  }
  view.cart.slice(0, 5).forEach((item, index) => {
    const y = 190 + index * 72;
    ctx.fillStyle = index % 2 ? "rgba(255, 255, 255, 0.28)" : "rgba(159, 184, 143, 0.2)";
    roundRect(ctx, 52, y, 708, 54, 14);
    ctx.fill();
    ctx.fillStyle = "#302d18";
    ctx.font = "850 24px system-ui, sans-serif";
    ctx.textAlign = "left";
    wrapCanvasText(ctx, describeOrder(item.order), 560, 1).forEach((line) => ctx.fillText(line, 74, y + 34));
    ctx.textAlign = "right";
    ctx.fillText(`${orderTotal(item.order)} 元`, 742, y + 34);
    addKioskButton(ctx, buttons, 786, y + 6, 128, 42, copy("remove", view.language), { type: "removeItem", id: item.id }, { tone: "ghost", small: true });
  });

  if (view.cart.length > 5) {
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(48, 45, 24, 0.62)";
    ctx.font = "800 22px system-ui, sans-serif";
    ctx.fillText(`+${view.cart.length - 5}`, 74, 562);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "#302d18";
  ctx.font = "900 40px system-ui, sans-serif";
  ctx.fillText(`${copy("total", view.language)} ${cartTotal(view.cart)} 元`, 950, 582);
  addKioskButton(ctx, buttons, 52, 642, 170, 58, copy("addMore", view.language), { type: "back" }, { tone: "ghost" });
  addKioskButton(ctx, buttons, 244, 642, 170, 58, copy("clear", view.language), { type: "clearCart" }, { tone: "ghost", disabled: !view.cart.length });
  addKioskButton(ctx, buttons, 708, 642, 242, 58, copy("checkout", view.language), { type: "checkout" }, { tone: "primary", disabled: !view.cart.length });
}

function drawReceiptScreen(ctx: CanvasRenderingContext2D, view: KioskViewModel, buttons: KioskButton[]) {
  drawSectionTitle(ctx, copy("receipt", view.language), 52, 144);
  const receipt = view.receipt;
  const lines = receipt?.lines ?? [];
  lines.slice(0, 6).forEach((line, index) => {
    ctx.fillStyle = index % 2 ? "rgba(255, 255, 255, 0.22)" : "rgba(159, 184, 143, 0.16)";
    roundRect(ctx, 70, 190 + index * 58, 884, 44, 12);
    ctx.fill();
    ctx.fillStyle = "#302d18";
    ctx.font = "820 22px system-ui, sans-serif";
    ctx.textAlign = "left";
    wrapCanvasText(ctx, line, 810, 1).forEach((text) => ctx.fillText(text, 94, 218 + index * 58));
  });
  ctx.textAlign = "right";
  ctx.fillStyle = "#302d18";
  ctx.font = "900 48px system-ui, sans-serif";
  ctx.fillText(`${copy("total", view.language)} ${receipt?.total ?? 0} 元`, 950, 582);
  addKioskButton(ctx, buttons, 52, 642, 170, 58, copy("newOrder", view.language), { type: "newOrder" }, { tone: "ghost" });
  addKioskButton(ctx, buttons, 708, 642, 242, 58, copy("done", view.language), { type: "close" }, { tone: "primary" });
}

function addKioskButton(
  ctx: CanvasRenderingContext2D,
  buttons: KioskButton[],
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  action: KioskAction,
  options: { tone?: "primary" | "ghost"; disabled?: boolean; small?: boolean; align?: "left" | "center" } = {},
) {
  const disabled = Boolean(options.disabled);
  const tone = options.tone ?? "default";
  const fill = disabled
    ? "rgba(48, 45, 24, 0.14)"
    : tone === "primary"
      ? "#9fb88f"
      : tone === "ghost"
        ? "rgba(48, 45, 24, 0.08)"
        : "#fffaf0";
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, width, height, 12);
  ctx.fill();
  ctx.strokeStyle = tone === "primary" ? "rgba(48, 45, 24, 0.22)" : "rgba(48, 45, 24, 0.16)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = disabled ? "rgba(48, 45, 24, 0.36)" : "#302d18";
  ctx.font = `${options.small ? 760 : 850} ${options.small ? 21 : 25}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = options.align === "left" ? "left" : "center";
  const lines = wrapCanvasText(ctx, label, width - 28, options.small ? 1 : 2);
  lines.forEach((line, index) => {
    const textY = y + height / 2 + (index - (lines.length - 1) / 2) * (options.small ? 22 : 26);
    ctx.fillText(line, options.align === "left" ? x + 20 : x + width / 2, textY);
  });
  if (!disabled) buttons.push({ x, y, width, height, action });
}

function drawSectionTitle(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 34) {
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#302d18";
  ctx.font = `900 ${size}px system-ui, sans-serif`;
  ctx.fillText(text, x, y);
}

function buildKioskRenderKey(open: boolean, view: KioskViewModel) {
  const selected = view.selected;
  return JSON.stringify({
    open,
    screen: view.screen,
    language: view.language,
    drinkPage: view.drinkPage,
    selected: [
      selected.quantity,
      selected.drink?.id,
      selected.size?.id,
      selected.sweetness?.id,
      selected.ice?.id,
      selected.toppings.map((item) => item.id).join(","),
    ],
    cart: view.cart.map((item) => `${item.id}:${orderTotal(item.order)}`).join("|"),
    receipt: view.receipt?.id,
  });
}

function copy(key: string, language: KioskLanguage) {
  const dictionary: Record<string, { en: string; zh: string }> = {
    add: { en: "Add to cart", zh: "加入購物車" },
    addMore: { en: "Add more", zh: "繼續加點" },
    back: { en: "Back", zh: "返回" },
    cart: { en: "Cart", zh: "購物車" },
    checkout: { en: "Checkout", zh: "結帳" },
    chooseDrink: { en: "Choose a drink", zh: "選擇飲料" },
    clear: { en: "Clear", zh: "清空" },
    done: { en: "Done", zh: "完成" },
    emptyCart: { en: "Your cart is empty", zh: "購物車是空的" },
    ice: { en: "Ice", zh: "冰塊" },
    lineTotal: { en: "Item total", zh: "小計" },
    newOrder: { en: "New order", zh: "新訂單" },
    next: { en: "Next", zh: "下一頁" },
    previous: { en: "Previous", zh: "上一頁" },
    publicMode: { en: "Public Mode", zh: "公開模式" },
    receipt: { en: "Receipt", zh: "收據" },
    remove: { en: "Remove", zh: "移除" },
    size: { en: "Size", zh: "杯型" },
    start: { en: "Start order", zh: "開始點餐" },
    sweetness: { en: "Sweetness", zh: "甜度" },
    tapToOrder: { en: "Tap to order", zh: "點一下開始點餐" },
    title: { en: "Boba Kiosk", zh: "珍奶自助點餐" },
    toppings: { en: "Toppings", zh: "加料" },
    total: { en: "Total", zh: "總計" },
    viewCart: { en: "View cart", zh: "查看購物車" },
  };
  return dictionary[key]?.[language] ?? key;
}

function optionLabel(option: MenuOption, language: KioskLanguage) {
  const english = englishOptionLabels[option.id] ?? option.label;
  if (language === "en") return english;
  return option.label;
}

function languageLabel(language: KioskLanguage) {
  if (language === "en") return "EN";
  return "中文";
}

const englishOptionLabels: Record<string, string> = {
  "aiyu": "Aiyu Jelly",
  "agar": "Agar",
  "black-tea": "Black Tea",
  "black-tea-latte": "Black Tea Latte",
  "boba": "Boba",
  "boba-milk-tea": "Boba Milk Tea",
  "brown-sugar-boba-milk": "Brown Sugar Boba Milk",
  "coconut-jelly": "Coconut Jelly",
  "grass-jelly": "Grass Jelly",
  "grass-jelly-milk-tea": "Grass Jelly Milk Tea",
  "green-tea": "Green Tea",
  "half-sugar": "Half Sugar",
  "hot": "Hot",
  "large": "Large",
  "lemon-black-tea": "Lemon Black Tea",
  "less-ice": "Less Ice",
  "less-sugar": "Less Sugar",
  "light-ice": "Light Ice",
  "light-sugar": "Light Sugar",
  "matcha-latte": "Matcha Latte",
  "medium": "Medium",
  "milk-foam": "Milk Foam",
  "milk-tea": "Milk Tea",
  "mini-pearl": "Mini Pearls",
  "no-ice": "No Ice",
  "no-sugar": "No Sugar",
  "oolong-milk-tea": "Oolong Milk Tea",
  "oolong-tea": "Oolong Tea",
  "orange-green-tea": "Orange Green Tea",
  "passion-green-tea": "Passion Green Tea",
  "pearl": "Pearls",
  "pearl-milk-tea": "Pearl Milk Tea",
  "pudding": "Pudding",
  "pudding-milk-tea": "Pudding Milk Tea",
  "regular-ice": "Regular Ice",
  "regular-sugar": "Regular Sugar",
  "sijichun": "Sijichun Tea",
  "taro-ball": "Taro Balls",
  "taro-milk": "Taro Milk",
  "tieguanyin-milk-tea": "Tieguanyin Milk Tea",
  "wintermelon-lemon": "Wintermelon Lemon",
  "yakult-green-tea": "Yakult Green Tea",
};

function getDebugParams() {
  const params = new URLSearchParams(window.location.search);
  const questLike = isQuestLikeDevice();
  const tuple = (name: string, fallback: [number, number, number]) => {
    const raw = params.get(name);
    if (!raw) return fallback;
    const values = raw.split(",").map(Number);
    return values.length === 3 && values.every(Number.isFinite) ? (values as [number, number, number]) : fallback;
  };
  const numberParam = (name: string, fallback: number) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const optionalNumberParam = (name: string, fallback?: number) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const boundedNumberParam = (name: string, fallback: number, min: number, max: number) => {
    return THREE.MathUtils.clamp(numberParam(name, fallback), min, max);
  };
  const defaultPixelRatio = questLike ? 1 : Math.min(window.devicePixelRatio, 2);

  return {
    bare: params.get("bare") === "1",
    noXr: params.get("noXr") === "1",
    simpleSplat: params.get("simpleSplat") === "1",
    gltfCharacters: params.get("avatar") === "glb",
    flipSplat: params.get("flip") === "1",
    camera: tuple("cam", [0, 1.45, 0.15]),
    target: tuple("target", [0, 1.45, -1.6]),
    splat: tuple("splat", [0, 0, 0]),
    splatScale: numberParam("splatScale", 1),
    fov: numberParam("fov", 62),
    pixelRatio: boundedNumberParam("pixelRatio", defaultPixelRatio, 0.5, 2),
    xrFramebufferScale: boundedNumberParam("xrScale", questLike ? 0.72 : 1, 0.5, 1.25),
    lodEnabled: params.get("lod") !== "0",
    lodSplatCount: optionalNumberParam("lodSplatCount", questLike ? 450_000 : undefined),
    lodRenderScale: boundedNumberParam("lodRenderScale", questLike ? 1.75 : 1.25, 1, 5),
    sparkMaxStdDev: boundedNumberParam("maxStdDev", Math.sqrt(5), Math.sqrt(4), Math.sqrt(9)),
    splatLodScale: boundedNumberParam("splatLodScale", questLike ? 0.85 : 1, 0.25, 2),
  };
}

function isQuestLikeDevice() {
  return /Quest|OculusBrowser|Meta Quest/i.test(navigator.userAgent);
}

function createFirstPersonLookControls(camera: THREE.PerspectiveCamera, element: HTMLElement, initialTarget: THREE.Vector3) {
  const sensitivity = 0.0028;
  const minPitch = -0.68;
  const maxPitch = 0.62;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let yaw = 0;
  let pitch = 0;
  let smoothYaw = 0;
  let smoothPitch = 0;
  let enabled = true;

  const setFromTarget = (target: THREE.Vector3) => {
    const direction = target.clone().sub(camera.position).normalize();
    yaw = Math.atan2(-direction.x, -direction.z);
    pitch = THREE.MathUtils.clamp(Math.asin(direction.y), minPitch, maxPitch);
    smoothYaw = yaw;
    smoothPitch = pitch;
    applyRotation();
  };

  const applyRotation = () => {
    camera.rotation.order = "YXZ";
    camera.rotation.set(smoothPitch, smoothYaw, 0);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!enabled) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    element.setPointerCapture(event.pointerId);
    element.classList.add("is-looking");
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!enabled || !dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    yaw -= dx * sensitivity;
    pitch = THREE.MathUtils.clamp(pitch - dy * sensitivity, minPitch, maxPitch);
  };

  const onPointerUp = (event: PointerEvent) => {
    dragging = false;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    element.classList.remove("is-looking");
  };

  const onContextMenu = (event: MouseEvent) => event.preventDefault();

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  element.addEventListener("contextmenu", onContextMenu);
  setFromTarget(initialTarget);

  return {
    update() {
      if (!enabled) return;
      smoothYaw = THREE.MathUtils.lerp(smoothYaw, yaw, 0.28);
      smoothPitch = THREE.MathUtils.lerp(smoothPitch, pitch, 0.28);
      applyRotation();
    },
    setEnabled(next: boolean) {
      enabled = next;
      if (!enabled) {
        dragging = false;
        element.classList.remove("is-looking");
      }
    },
    reset(target: THREE.Vector3) {
      setFromTarget(target);
    },
    dispose() {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("contextmenu", onContextMenu);
    },
  };
}

interface MenuBoardRow {
  label: string;
  price?: string;
  detail?: string;
}

interface MenuBoardPalette {
  faceTop: string;
  face: string;
  faceBottom: string;
  frame: string;
  frameDark: string;
  trim: string;
  ink: string;
  muted: string;
  row: string;
  rowAlt: string;
}

interface MenuBoardSpec {
  x: number;
  title: string;
  subtitle: string;
  footer: string;
  rotationY: number;
  palette: MenuBoardPalette;
  rows: MenuBoardRow[];
}

function createMenuBoards(): THREE.Group {
  const group = new THREE.Group();
  const boardWidth = 0.435;
  const boardHeight = 0.595;
  const boardGeometry = new THREE.PlaneGeometry(boardWidth, boardHeight);
  const shadowGeometry = new THREE.PlaneGeometry(boardWidth + 0.045, boardHeight + 0.055);
  const backingGeometry = new THREE.PlaneGeometry(1.42, 0.66);
  const fasciaGeometry = new THREE.PlaneGeometry(1.4, 0.16);
  const pinGeometry = new THREE.CircleGeometry(0.011, 20);
  const pinMaterial = new THREE.MeshStandardMaterial({ color: 0xb99754, roughness: 0.54, metalness: 0.1 });
  const backingTexture = makeMenuBackingTexture();
  const fasciaTexture = makeMenuFasciaTexture();
  const backingMaterial = new THREE.MeshStandardMaterial({
    map: backingTexture,
    emissiveMap: backingTexture,
    transparent: true,
    opacity: 1,
    alphaTest: 0.02,
    roughness: 0.94,
    metalness: 0.01,
    emissive: 0xffffff,
    emissiveIntensity: 0.018,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fasciaMaterial = new THREE.MeshStandardMaterial({
    map: fasciaTexture,
    emissiveMap: fasciaTexture,
    transparent: true,
    opacity: 0.98,
    alphaTest: 0.03,
    roughness: 0.88,
    metalness: 0.01,
    emissive: 0xffffff,
    emissiveIntensity: 0.02,
    side: THREE.DoubleSide,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  const backing = new THREE.Mesh(backingGeometry, backingMaterial);
  backing.position.set(-0.075, -0.015, -0.026);
  backing.renderOrder = 16;
  group.add(backing);

  const fascia = new THREE.Mesh(fasciaGeometry, fasciaMaterial);
  fascia.position.set(0, -boardHeight * 0.5 - 0.045, -0.004);
  fascia.renderOrder = 19;
  group.add(fascia);

  const boards: MenuBoardSpec[] = [
    {
      x: -0.43,
      title: "招牌奶茶",
      subtitle: "MILK TEA",
      footer: "人氣推薦",
      rotationY: 0.025,
      palette: {
        faceTop: "#d5dfae",
        face: "#aebf80",
        faceBottom: "#738457",
        frame: "#9a7a42",
        frameDark: "#5a3b24",
        trim: "#f1e7c8",
        ink: "#302d18",
        muted: "rgba(48, 45, 24, 0.68)",
        row: "rgba(255, 245, 216, 0.36)",
        rowAlt: "rgba(255, 245, 216, 0.2)",
      },
      rows: [
        { label: "奶茶", price: "45" },
        { label: "珍珠奶茶", price: "60" },
        { label: "波霸奶茶", price: "65" },
        { label: "烏龍奶茶", price: "55" },
        { label: "黑糖珍珠鮮奶", price: "75" },
      ],
    },
    {
      x: 0,
      title: "清爽茶飲",
      subtitle: "FRUIT TEA",
      footer: "現泡茶底",
      rotationY: 0,
      palette: {
        faceTop: "#f4e9cb",
        face: "#dfca90",
        faceBottom: "#a8894f",
        frame: "#856233",
        frameDark: "#513622",
        trim: "#fff5d8",
        ink: "#2c2416",
        muted: "rgba(48, 45, 24, 0.62)",
        row: "rgba(255, 245, 216, 0.34)",
        rowAlt: "rgba(255, 245, 216, 0.18)",
      },
      rows: [
        { label: "紅茶", price: "35" },
        { label: "四季春青茶", price: "45" },
        { label: "冬瓜檸檬", price: "50" },
        { label: "百香綠茶", price: "55" },
        { label: "柳橙綠茶", price: "55" },
      ],
    },
    {
      x: 0.43,
      title: "客製選項",
      subtitle: "CUSTOM",
      footer: "慢慢說沒問題",
      rotationY: -0.025,
      palette: {
        faceTop: "#50623f",
        face: "#647c52",
        faceBottom: "#34432a",
        frame: "#7b6136",
        frameDark: "#44301f",
        trim: "#f1e7c8",
        ink: "#fff5d8",
        muted: "rgba(255, 245, 216, 0.68)",
        row: "rgba(255, 245, 216, 0.13)",
        rowAlt: "rgba(48, 45, 24, 0.22)",
      },
      rows: [
        { label: "杯型", detail: "中杯 / 大杯 +10" },
        { label: "甜度", detail: "正常 少糖 半糖 微糖 無糖" },
        { label: "冰塊", detail: "正常 少冰 微冰 去冰 熱" },
        { label: "加料", detail: "珍珠 波霸 布丁 椰果" },
      ],
    },
  ];

  boards.forEach((board) => {
    const shadow = new THREE.Mesh(
      shadowGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x120c08,
        transparent: true,
        opacity: 0.055,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: true,
      }),
    );
    shadow.position.set(board.x + 0.012, -0.016, -0.014);
    shadow.rotation.y = board.rotationY;
    shadow.renderOrder = 17;
    group.add(shadow);

    const texture = makeBoardTexture(board);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      transparent: true,
      opacity: 0.965,
      roughness: 0.88,
      metalness: 0.01,
      emissive: 0xffffff,
      emissiveIntensity: 0.062,
      side: THREE.DoubleSide,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(boardGeometry, material);
    mesh.position.set(board.x, 0, 0);
    mesh.rotation.y = board.rotationY;
    mesh.renderOrder = 22;
    group.add(mesh);

    [
      [-boardWidth * 0.38, boardHeight * 0.43],
      [boardWidth * 0.38, boardHeight * 0.43],
      [-boardWidth * 0.38, -boardHeight * 0.43],
      [boardWidth * 0.38, -boardHeight * 0.43],
    ].forEach(([pinX, pinY]) => {
      const pin = new THREE.Mesh(pinGeometry, pinMaterial);
      pin.position.set(board.x + pinX, pinY, 0.006);
      pin.rotation.y = board.rotationY;
      pin.renderOrder = 24;
      group.add(pin);
    });
  });

  return group;
}

function makeMenuBackingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 496;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const base = ctx.createLinearGradient(0, 0, 0, canvas.height);
  base.addColorStop(0, "rgba(181, 123, 78, 0.96)");
  base.addColorStop(0.38, "rgba(142, 94, 58, 0.98)");
  base.addColorStop(1, "rgba(103, 67, 42, 0.94)");
  ctx.fillStyle = base;
  roundRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 34);
  ctx.fill();

  ctx.save();
  roundRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 34);
  ctx.clip();
  for (let stripe = 0; stripe < 11; stripe += 1) {
    const y = 18 + stripe * 44;
    const tone = stripe % 2 === 0 ? "rgba(255, 245, 216, 0.04)" : "rgba(48, 45, 24, 0.06)";
    ctx.fillStyle = tone;
    ctx.fillRect(8, y, canvas.width - 16, 2);
  }

  for (let line = 0; line < 20; line += 1) {
    const y = seededNoise(line, 11.2) * canvas.height;
    const alpha = 0.028 + seededNoise(line, 14.8) * 0.052;
    ctx.strokeStyle = `rgba(255, 245, 216, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 1 + seededNoise(line, 21.1) * 2;
    ctx.beginPath();
    ctx.moveTo(26, y);
    for (let x = 88; x < canvas.width - 26; x += 80) {
      ctx.lineTo(x, y + (seededNoise(line + x, 5.7) - 0.5) * 18);
    }
    ctx.stroke();
  }

  const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 130, canvas.width / 2, canvas.height / 2, 610);
  vignette.addColorStop(0, "rgba(255, 245, 216, 0.045)");
  vignette.addColorStop(0.62, "rgba(48, 45, 24, 0.015)");
  vignette.addColorStop(1, "rgba(16, 10, 6, 0.16)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  ctx.globalCompositeOperation = "destination-in";
  const horizontalMask = ctx.createLinearGradient(0, 0, canvas.width, 0);
  horizontalMask.addColorStop(0, "rgba(0, 0, 0, 0)");
  horizontalMask.addColorStop(0.075, "rgba(0, 0, 0, 0.72)");
  horizontalMask.addColorStop(0.15, "rgba(0, 0, 0, 1)");
  horizontalMask.addColorStop(0.85, "rgba(0, 0, 0, 1)");
  horizontalMask.addColorStop(0.925, "rgba(0, 0, 0, 0.72)");
  horizontalMask.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = horizontalMask;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const verticalMask = ctx.createLinearGradient(0, 0, 0, canvas.height);
  verticalMask.addColorStop(0, "rgba(0, 0, 0, 0)");
  verticalMask.addColorStop(0.14, "rgba(0, 0, 0, 0.58)");
  verticalMask.addColorStop(0.28, "rgba(0, 0, 0, 1)");
  verticalMask.addColorStop(0.88, "rgba(0, 0, 0, 1)");
  verticalMask.addColorStop(0.95, "rgba(0, 0, 0, 0.76)");
  verticalMask.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = verticalMask;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function makeMenuFasciaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const body = ctx.createLinearGradient(0, 0, 0, canvas.height);
  body.addColorStop(0, "rgba(102, 67, 41, 0.98)");
  body.addColorStop(0.5, "rgba(129, 83, 48, 0.98)");
  body.addColorStop(1, "rgba(69, 43, 27, 0.96)");
  ctx.fillStyle = body;
  roundRect(ctx, 8, 4, canvas.width - 16, canvas.height - 10, 10);
  ctx.fill();

  ctx.save();
  roundRect(ctx, 8, 4, canvas.width - 16, canvas.height - 10, 10);
  ctx.clip();
  for (let line = 0; line < 16; line += 1) {
    const y = 16 + seededNoise(line, 42.2) * (canvas.height - 32);
    ctx.strokeStyle = line % 2 === 0 ? "rgba(255, 245, 216, 0.08)" : "rgba(48, 30, 18, 0.14)";
    ctx.lineWidth = 1 + seededNoise(line, 8.7) * 2;
    ctx.beginPath();
    ctx.moveTo(16, y);
    for (let x = 80; x < canvas.width - 12; x += 80) {
      ctx.lineTo(x, y + (seededNoise(line + x, 2.9) - 0.5) * 9);
    }
    ctx.stroke();
  }
  const bottomShade = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bottomShade.addColorStop(0, "rgba(255, 245, 216, 0.08)");
  bottomShade.addColorStop(0.46, "rgba(255, 245, 216, 0)");
  bottomShade.addColorStop(1, "rgba(24, 15, 9, 0.28)");
  ctx.fillStyle = bottomShade;
  ctx.fillRect(8, 4, canvas.width - 16, canvas.height - 10);
  ctx.restore();

  const sideMask = ctx.createLinearGradient(0, 0, canvas.width, 0);
  sideMask.addColorStop(0, "rgba(0, 0, 0, 0)");
  sideMask.addColorStop(0.04, "rgba(0, 0, 0, 0.72)");
  sideMask.addColorStop(0.09, "rgba(0, 0, 0, 1)");
  sideMask.addColorStop(0.5, "rgba(0, 0, 0, 1)");
  sideMask.addColorStop(0.91, "rgba(0, 0, 0, 1)");
  sideMask.addColorStop(0.96, "rgba(0, 0, 0, 0.72)");
  sideMask.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = sideMask;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function makeBoardTexture(board: MenuBoardSpec): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 576;
  canvas.height = 800;
  const ctx = canvas.getContext("2d")!;

  drawBoardBase(ctx, board.palette);
  drawBoardHeader(ctx, board);
  drawBoardRows(ctx, board.rows, board.palette);
  drawBoardFooter(ctx, board.footer, board.palette);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function drawBoardBase(ctx: CanvasRenderingContext2D, palette: MenuBoardPalette) {
  const { width, height } = ctx.canvas;

  ctx.fillStyle = palette.frameDark;
  roundRect(ctx, 0, 0, width, height, 22);
  ctx.fill();

  const frame = ctx.createLinearGradient(0, 0, width, height);
  frame.addColorStop(0, palette.frame);
  frame.addColorStop(0.48, "#6f4e2b");
  frame.addColorStop(1, palette.frameDark);
  ctx.fillStyle = frame;
  roundRect(ctx, 18, 18, width - 36, height - 36, 18);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 245, 216, 0.22)";
  ctx.lineWidth = 5;
  ctx.stroke();

  const face = ctx.createLinearGradient(42, 54, 42, height - 54);
  face.addColorStop(0, palette.faceTop);
  face.addColorStop(0.45, palette.face);
  face.addColorStop(1, palette.faceBottom);
  ctx.fillStyle = face;
  roundRect(ctx, 42, 52, width - 84, height - 104, 12);
  ctx.fill();

  ctx.save();
  roundRect(ctx, 42, 52, width - 84, height - 104, 12);
  ctx.clip();

  const wash = ctx.createRadialGradient(width * 0.24, 145, 40, width * 0.24, 145, 420);
  wash.addColorStop(0, "rgba(255, 245, 216, 0.22)");
  wash.addColorStop(0.62, "rgba(255, 245, 216, 0.04)");
  wash.addColorStop(1, "rgba(48, 45, 24, 0.18)");
  ctx.fillStyle = wash;
  ctx.fillRect(42, 52, width - 84, height - 104);

  const sideShade = ctx.createLinearGradient(42, 0, width - 42, 0);
  sideShade.addColorStop(0, "rgba(48, 45, 24, 0.24)");
  sideShade.addColorStop(0.12, "rgba(48, 45, 24, 0)");
  sideShade.addColorStop(0.88, "rgba(48, 45, 24, 0)");
  sideShade.addColorStop(1, "rgba(48, 45, 24, 0.26)");
  ctx.fillStyle = sideShade;
  ctx.fillRect(42, 52, width - 84, height - 104);

  drawFineGrain(ctx, 42, 52, width - 84, height - 104);
  ctx.restore();
}

function drawBoardHeader(ctx: CanvasRenderingContext2D, board: MenuBoardSpec) {
  const { width } = ctx.canvas;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = board.palette.muted;
  ctx.font = "800 20px system-ui, sans-serif";
  ctx.fillText(board.subtitle, width / 2, 86);

  ctx.save();
  ctx.shadowColor = "rgba(48, 45, 24, 0.28)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = board.palette.ink;
  ctx.font = "850 55px system-ui, sans-serif";
  ctx.fillText(board.title, width / 2, 132);
  ctx.restore();

  const divider = ctx.createLinearGradient(92, 0, width - 92, 0);
  divider.addColorStop(0, "rgba(241, 231, 200, 0)");
  divider.addColorStop(0.5, board.palette.trim);
  divider.addColorStop(1, "rgba(241, 231, 200, 0)");
  ctx.strokeStyle = divider;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(92, 184);
  ctx.lineTo(width - 92, 184);
  ctx.stroke();
}

function drawBoardRows(ctx: CanvasRenderingContext2D, rows: MenuBoardRow[], palette: MenuBoardPalette) {
  const detailed = rows.some((row) => row.detail);
  const rowHeight = detailed ? 72 : 54;
  const rowStep = detailed ? 89 : 66;
  const startY = detailed ? 284 : 278;

  rows.forEach((row, index) => {
    const y = startY + index * rowStep;
    ctx.fillStyle = index % 2 === 0 ? palette.row : palette.rowAlt;
    roundRect(ctx, 72, y - rowHeight / 2, 432, rowHeight, 12);
    ctx.fill();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = palette.ink;
    ctx.font = detailed ? "820 33px system-ui, sans-serif" : "760 37px system-ui, sans-serif";
    ctx.fillText(row.label, 94, detailed ? y - 13 : y + 1);

    if (row.detail) {
      ctx.fillStyle = palette.muted;
      ctx.font = "650 25px system-ui, sans-serif";
      ctx.fillText(row.detail, 94, y + 20);
    }

    if (row.price) {
      ctx.textAlign = "right";
      ctx.fillStyle = palette.ink;
      ctx.font = "800 35px system-ui, sans-serif";
      ctx.fillText(row.price, 478, y + 1);
    }
  });
}

function drawBoardFooter(ctx: CanvasRenderingContext2D, text: string, palette: MenuBoardPalette) {
  const { width } = ctx.canvas;
  ctx.fillStyle = "rgba(48, 45, 24, 0.26)";
  roundRect(ctx, 112, 694, width - 224, 52, 26);
  ctx.fill();
  ctx.strokeStyle = "rgba(241, 231, 200, 0.22)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = palette.trim;
  ctx.font = "760 24px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, 721);
}

function drawFineGrain(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.save();
  for (let index = 0; index < 260; index += 1) {
    const px = x + seededNoise(index, 0.17) * width;
    const py = y + seededNoise(index, 4.71) * height;
    const size = 0.8 + seededNoise(index, 9.32) * 1.7;
    ctx.fillStyle = seededNoise(index, 2.01) > 0.55 ? "rgba(255, 245, 216, 0.09)" : "rgba(48, 45, 24, 0.08)";
    ctx.fillRect(px, py, size, size);
  }
  ctx.restore();
}

function seededNoise(index: number, salt: number): number {
  const raw = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function createDrinkPreview(): THREE.Group {
  const group = new THREE.Group();
  const teaMaterial = new THREE.MeshStandardMaterial({ color: 0xc98956, roughness: 0.62 });
  const tea = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.09, 0.36, 40),
    teaMaterial,
  );
  tea.position.y = -0.02;
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.122, 0.096, 0.18, 40, 1, true, -Math.PI * 0.74, Math.PI * 1.48),
    new THREE.MeshStandardMaterial({ color: 0xf2dfaf, roughness: 0.7, side: THREE.DoubleSide }),
  );
  sleeve.position.y = -0.015;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.01, 8, 40),
    new THREE.MeshStandardMaterial({ color: 0xffefc6, roughness: 0.42 }),
  );
  rim.position.y = 0.165;
  rim.rotation.x = Math.PI / 2;
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.12, 0.035, 40),
    new THREE.MeshStandardMaterial({ color: 0xf6eadb, roughness: 0.35 }),
  );
  lid.position.y = 0.2;
  const straw = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.32, 10),
    new THREE.MeshStandardMaterial({ color: 0xb8c98f, roughness: 0.38 }),
  );
  straw.position.set(0.055, 0.31, 0.01);
  straw.rotation.z = -0.18;
  const pearls: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[] = [];
  group.add(tea, sleeve, rim, lid, straw);
  for (let index = 0; index < 12; index += 1) {
    const pearl = new THREE.Mesh(
      new THREE.CircleGeometry(0.022, 24),
      new THREE.MeshBasicMaterial({ color: 0x120906, transparent: true, opacity: 1, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
    );
    pearl.material.userData.alwaysTransparent = true;
    const row = Math.floor(index / 4);
    const column = index % 4;
    const x = (column - 1.5) * 0.044 + (row % 2) * 0.012;
    const y = 0.025 + row * 0.032;
    const z = 0.128 + seededNoise(index, 11.2) * 0.012;
    pearl.position.set(x, y, z);
    pearl.visible = false;
    pearls.push(pearl);
    group.add(pearl);
  }
  group.scale.setScalar(1.1);
  group.userData.teaMaterial = teaMaterial;
  group.userData.pearls = pearls;
  group.traverse((object) => {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
    if (!mesh.isMesh) return;
    mesh.renderOrder = 70;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      material.depthWrite = false;
      material.depthTest = false;
    });
  });
  pearls.forEach((pearl) => {
    pearl.renderOrder = 76;
  });
  return group;
}

function updateDrinkPreview(group: THREE.Group, order: Order) {
  const teaMaterial = group.userData.teaMaterial as THREE.MeshStandardMaterial | undefined;
  teaMaterial?.color.setHex(drinkColor(order));
  const pearls = group.userData.pearls as THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[] | undefined;
  const showPearls = orderHasPearls(order);
  pearls?.forEach((pearl, index) => {
    pearl.visible = showPearls;
    pearl.scale.setScalar(showPearls && order.toppings.some((topping) => topping.id === "boba") ? 1.12 : 1);
    pearl.position.z = 0.128 + seededNoise(index, 11.2) * 0.012;
  });
}

function buildDrinkVisualKey(order: Order) {
  return [order.drink?.id ?? "none", order.ice?.id ?? "none", order.toppings.map((topping) => topping.id).join(",")].join(":");
}

function orderHasPearls(order: Order) {
  const drinkId = order.drink?.id ?? "";
  const toppingIds = new Set(order.toppings.map((topping) => topping.id));
  return (
    drinkId.includes("pearl") ||
    drinkId.includes("boba") ||
    drinkId === "brown-sugar-boba-milk" ||
    toppingIds.has("pearl") ||
    toppingIds.has("boba") ||
    toppingIds.has("mini-pearl")
  );
}

function drinkColor(order: Order) {
  const drinkId = order.drink?.id ?? "";
  if (drinkId.includes("green") || drinkId === "sijichun" || drinkId === "matcha-latte") return 0x9dad66;
  if (drinkId.includes("black-tea")) return 0x9b5537;
  if (drinkId.includes("wintermelon")) return 0xd0a357;
  if (drinkId.includes("taro")) return 0xba86b8;
  if (drinkId.includes("brown-sugar")) return 0xb67749;
  return 0xc98a58;
}

function createConfettiBurst() {
  const group = new THREE.Group();
  group.visible = false;
  group.position.set(0, 1.14, -0.72);

  const geometry = new THREE.PlaneGeometry(0.024, 0.055);
  const palette = [0xf1e7c8, 0xb8c98f, 0x9fb88f, 0x846f18, 0xbd7659, 0xffd88a];
  const pieces: Array<{
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    origin: THREE.Vector3;
    velocity: THREE.Vector3;
    spin: THREE.Vector3;
    delay: number;
  }> = [];

  for (let index = 0; index < 84; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: palette[index % palette.length],
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 130;
    group.add(mesh);

    const angle = seededNoise(index, 3.1) * Math.PI * 2;
    const radius = 0.16 + seededNoise(index, 5.2) * 0.42;
    pieces.push({
      mesh,
      origin: new THREE.Vector3((seededNoise(index, 0.7) - 0.5) * 0.18, (seededNoise(index, 1.4) - 0.5) * 0.08, 0),
      velocity: new THREE.Vector3(Math.cos(angle) * radius, 0.55 + seededNoise(index, 2.6) * 0.44, Math.sin(angle) * radius * 0.28),
      spin: new THREE.Vector3(4 + seededNoise(index, 7.8) * 9, 3 + seededNoise(index, 8.9) * 7, 5 + seededNoise(index, 9.6) * 12),
      delay: seededNoise(index, 4.3) * 0.3,
    });
  }

  let startedAt = -Infinity;
  let active = false;

  return {
    group,
    start(now: number) {
      active = true;
      startedAt = now;
      group.visible = true;
      pieces.forEach((piece) => {
        piece.mesh.visible = true;
        piece.mesh.material.opacity = 1;
      });
    },
    update(now: number) {
      if (!active) return;
      const elapsed = now - startedAt;
      if (elapsed > 3.8) {
        active = false;
        group.visible = false;
        return;
      }

      pieces.forEach((piece, index) => {
        const t = Math.max(0, elapsed - piece.delay);
        piece.mesh.visible = t > 0;
        if (t <= 0) return;

        piece.mesh.position.copy(piece.origin).addScaledVector(piece.velocity, t);
        piece.mesh.position.y -= 0.34 * t * t;
        piece.mesh.rotation.set(piece.spin.x * t, piece.spin.y * t, piece.spin.z * t + index);
        piece.mesh.material.opacity = THREE.MathUtils.clamp(1 - Math.max(0, t - 1.7) / 1.6, 0, 1);
      });
    },
    dispose() {
      geometry.dispose();
      pieces.forEach((piece) => piece.mesh.material.dispose());
    },
  };
}

function createTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(241, 231, 200, 0.94)";
  roundRect(ctx, 24, 34, 464, 158, 28);
  ctx.fill();
  ctx.strokeStyle = "rgba(132, 111, 24, 0.9)";
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.fillStyle = "#302d18";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = text.length > 3 ? "700 54px system-ui, sans-serif" : "800 128px system-ui, sans-serif";
  ctx.fillText(text, 256, 113);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.renderOrder = 90;
  sprite.scale.set(0.62, 0.31, 1);
  return sprite;
}

function createReceiptDisplay() {
  const group = new THREE.Group();
  group.visible = false;

  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 1040;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const receiptGeometry = new THREE.PlaneGeometry(0.48, 0.65);
  const shadowGeometry = new THREE.PlaneGeometry(0.53, 0.7);
  const hitGeometry = new THREE.PlaneGeometry(0.56, 0.74);

  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x120c08,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.position.set(0.018, -0.018, -0.012);
  shadow.renderOrder = 70;

  const receiptMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: 0xffffff,
    emissiveIntensity: 0.04,
    roughness: 0.72,
    metalness: 0.01,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const receiptMesh = new THREE.Mesh(receiptGeometry, receiptMaterial);
  receiptMesh.renderOrder = 80;

  const hitArea = new THREE.Mesh(
    hitGeometry,
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  );
  hitArea.position.z = 0.018;
  hitArea.userData.focusTarget = "receipt";
  hitArea.renderOrder = 82;

  group.add(shadow, receiptMesh, hitArea);

  const update = (receipt: Receipt) => {
    drawReceiptTexture(ctx, receipt);
    texture.needsUpdate = true;
  };

  update({
    id: "placeholder",
    mode: "arcade",
    recognized: { quantity: 1, toppings: [] },
    score: 0,
    scoreParts: { correctness: 0, politeness: 0, smoothness: 0, clarity: 0 },
    success: true,
    lines: [],
    createdAt: new Date().toISOString(),
  });

  return {
    group,
    hitArea,
    update,
    setOpacity(opacity: number) {
      receiptMaterial.opacity = opacity;
      shadowMaterial.opacity = 0.24 * opacity;
    },
    dispose() {
      texture.dispose();
      receiptGeometry.dispose();
      shadowGeometry.dispose();
      hitGeometry.dispose();
      receiptMaterial.dispose();
      shadowMaterial.dispose();
      hitArea.material.dispose();
    },
  };
}

function drawReceiptTexture(ctx: CanvasRenderingContext2D, receipt: Receipt) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#f1e7c8";
  roundRect(ctx, 28, 20, width - 56, height - 40, 18);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 245, 216, 0.58)";
  roundRect(ctx, 52, 48, width - 104, height - 96, 12);
  ctx.fill();

  ctx.strokeStyle = "rgba(132, 111, 24, 0.28)";
  ctx.lineWidth = 3;
  ctx.setLineDash([16, 14]);
  ctx.beginPath();
  ctx.moveTo(62, 188);
  ctx.lineTo(width - 62, 188);
  ctx.moveTo(62, height - 172);
  ctx.lineTo(width - 62, height - 172);
  ctx.stroke();
  ctx.setLineDash([]);

  drawReceiptPerforation(ctx, 36);
  drawReceiptPerforation(ctx, height - 36);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#302d18";
  ctx.font = "900 54px system-ui, sans-serif";
  ctx.fillText("珍奶快打", width / 2, 72);
  ctx.fillStyle = "#846f18";
  ctx.font = "800 26px system-ui, sans-serif";
  ctx.fillText(receipt.mode === "arcade" ? "挑戰收據" : "自由練習收據", width / 2, 134);

  ctx.fillStyle = "#302d18";
  ctx.font = "950 152px system-ui, sans-serif";
  ctx.fillText(String(receipt.score), width / 2, 218);
  ctx.fillStyle = "#846f18";
  ctx.font = "900 34px system-ui, sans-serif";
  ctx.fillText("分", width / 2 + 118, 308);

  const createdAt = new Date(receipt.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  ctx.fillStyle = "rgba(48, 45, 24, 0.72)";
  ctx.font = "750 24px system-ui, sans-serif";
  ctx.fillText(createdAt, width / 2, 386);

  ctx.textAlign = "left";
  ctx.fillStyle = "#302d18";
  ctx.font = "800 31px system-ui, sans-serif";
  let y = 456;
  const detailBottom = height - 286;
  receipt.lines.forEach((line) => {
    if (y > detailBottom - 40) return;
    const lines = wrapCanvasText(ctx, line, width - 148, 2);
    lines.forEach((wrapped) => {
      if (y > detailBottom - 40) return;
      ctx.fillText(wrapped, 74, y);
      y += 42;
    });
    y += 8;
  });

  const parts = [
    ["正確", receipt.scoreParts.correctness, 60],
    ["禮貌", receipt.scoreParts.politeness, 15],
    ["順暢", receipt.scoreParts.smoothness, 15],
    ["清楚", receipt.scoreParts.clarity, 10],
  ] as const;
  y = height - 154;
  parts.forEach(([label, value, max], index) => {
    const rowY = y + index * 28;
    ctx.fillStyle = "rgba(48, 45, 24, 0.72)";
    ctx.font = "780 20px system-ui, sans-serif";
    ctx.fillText(label, 74, rowY);
    ctx.fillStyle = "rgba(132, 111, 24, 0.18)";
    roundRect(ctx, 152, rowY + 3, 430, 12, 6);
    ctx.fill();
    ctx.fillStyle = index % 2 === 0 ? "#9fb88f" : "#bd7659";
    roundRect(ctx, 152, rowY + 3, 430 * Math.max(0, Math.min(1, value / max)), 12, 6);
    ctx.fill();
    ctx.fillStyle = "#302d18";
    ctx.font = "800 20px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(value), width - 74, rowY - 2);
    ctx.textAlign = "left";
  });
}

function drawReceiptPerforation(ctx: CanvasRenderingContext2D, y: number) {
  ctx.save();
  ctx.fillStyle = "#302d18";
  ctx.globalAlpha = 0.14;
  for (let x = 58; x < ctx.canvas.width - 54; x += 26) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function createDynamicPanelSprite(options: {
  width: number;
  height: number;
  title: string;
  accent: string;
  background: string;
  textColor: string;
  titleFont?: string;
  bodyFont?: string;
  bodyTop?: number;
  lineHeight?: number;
  maxLines?: number;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  sprite.renderOrder = 100;

  const update = (text: string, title = options.title) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = options.background;
    roundRect(ctx, 18, 18, canvas.width - 36, canvas.height - 36, 34);
    ctx.fill();
    ctx.strokeStyle = "rgba(241, 231, 200, 0.2)";
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.fillStyle = options.accent;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = options.titleFont ?? "800 44px system-ui, sans-serif";
    ctx.fillText(title, 64, 52);

    ctx.fillStyle = options.textColor;
    ctx.font = options.bodyFont ?? "800 66px system-ui, sans-serif";
    const lines = wrapCanvasText(ctx, text, canvas.width - 128, options.maxLines ?? 2);
    lines.forEach((line, index) => {
      ctx.fillText(line, 64, (options.bodyTop ?? 118) + index * (options.lineHeight ?? 76));
    });

    texture.needsUpdate = true;
  };

  update("");
  return { sprite, update };
}

function createLoadingPanelSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 520;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = "loading-panel";
  sprite.renderOrder = 180;

  const update = (title: string, status: string, progress: number, ready = false) => {
    const clampedProgress = THREE.MathUtils.clamp(progress, 0, 100);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    bg.addColorStop(0, "rgba(35, 31, 20, 0.94)");
    bg.addColorStop(1, "rgba(62, 54, 31, 0.92)");
    ctx.fillStyle = bg;
    roundRect(ctx, 34, 34, canvas.width - 68, canvas.height - 68, 38);
    ctx.fill();
    ctx.strokeStyle = "rgba(241, 231, 200, 0.28)";
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#b8c98f";
    ctx.font = "900 42px system-ui, sans-serif";
    ctx.fillText(title, 90, 104);

    ctx.fillStyle = "rgba(255, 245, 216, 0.82)";
    ctx.font = "780 34px system-ui, sans-serif";
    wrapCanvasText(ctx, status, 820, 2).forEach((line, index) => {
      ctx.fillText(line, 90, 184 + index * 42);
    });

    ctx.fillStyle = "rgba(255, 245, 216, 0.18)";
    roundRect(ctx, 90, 316, 780, 34, 17);
    ctx.fill();
    ctx.fillStyle = "#b8c98f";
    roundRect(ctx, 90, 316, 780 * (clampedProgress / 100), 34, 17);
    ctx.fill();

    ctx.textAlign = "right";
    ctx.fillStyle = "#fff5d8";
    ctx.font = "900 40px system-ui, sans-serif";
    ctx.fillText(`${Math.round(clampedProgress)}%`, 920, 308);

    if (ready) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#b8c98f";
      roundRect(ctx, 668, 420, 220, 58, 18);
      ctx.fill();
      ctx.fillStyle = "#302d18";
      ctx.font = "900 30px system-ui, sans-serif";
      ctx.fillText("Enter", 778, 434);
      ctx.fillStyle = "rgba(255, 245, 216, 0.76)";
      ctx.font = "760 24px system-ui, sans-serif";
      ctx.fillText("Select to begin", 778, 478);
    }

    texture.needsUpdate = true;
  };

  update("Boba Tea Shop", "Loading scene...", 0);
  return {
    sprite,
    update,
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const chunks = text.includes(" ") ? text.split(/\s+/g) : Array.from(text);
  const lines: string[] = [];
  let line = "";

  chunks.forEach((chunk) => {
    const candidate = text.includes(" ") ? `${line}${line ? " " : ""}${chunk}` : `${line}${chunk}`;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = chunk;
    } else {
      line = candidate;
    }
  });

  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines);
    clipped[maxLines - 1] = `${clipped[maxLines - 1].slice(0, Math.max(1, clipped[maxLines - 1].length - 1))}…`;
    return clipped;
  }
  return lines;
}

function hasOrderContent(order: Order): boolean {
  return Boolean(
    order.drink ||
      order.size ||
      order.sweetness ||
      order.ice ||
      order.toppings.length ||
      order.quantity > 1,
  );
}

function setObjectOpacity(root: THREE.Object3D, opacity: number) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!material) return;
      const baseOpacity = typeof material.userData.baseOpacity === "number" ? material.userData.baseOpacity : material.opacity;
      material.userData.baseOpacity = baseOpacity;
      const nextOpacity = baseOpacity * opacity;
      material.transparent = material.userData.alwaysTransparent === true || nextOpacity < 0.999;
      material.opacity = nextOpacity;
    });
  });
}

function applyCashierRootPose(root: THREE.Object3D, tuning: CashierPoseTuning, bob = 0) {
  root.position.set(CASHIER_POS[0], CASHIER_POS[1] + tuning.rootY + bob, CASHIER_POS[2] + tuning.rootZ);
  root.scale.setScalar(tuning.scale);
}

function resolveCashierArmaturePose(tuning: CashierPoseTuning) {
  return {
    shoulderX: tuning.shoulderX + tuning.shoulderSpread,
    shoulderY: tuning.shoulderY - tuning.shoulderDrop,
    shoulderZ: tuning.shoulderZ + tuning.shoulderBack,
    elbowX: tuning.elbowX + tuning.shoulderSpread * 0.18,
    elbowY: tuning.elbowY - tuning.elbowDrop - tuning.upperArmDown * 0.016,
    elbowZ: tuning.elbowZ + tuning.elbowBack + tuning.shoulderBack * 0.36,
    shoulderRotX: tuning.shoulderRotX - tuning.shoulderBack * 0.24,
    shoulderRotY: tuning.shoulderRotY,
    shoulderRotZ: tuning.shoulderRotZ,
    upperArmRotX: tuning.upperArmRotX + tuning.upperArmForward * 0.9,
    upperArmRotY: tuning.upperArmRotY + tuning.upperArmTwist,
    upperArmRotZ: tuning.upperArmRotZ + tuning.upperArmDown * 1.46,
    elbowRotX: tuning.elbowRotX,
    elbowRotY: tuning.elbowRotY + tuning.upperArmTwist * 0.18,
    elbowRotZ: tuning.elbowRotZ + tuning.elbowBend * 1.55 + tuning.upperArmDown * 0.22,
    wristRotZ: tuning.wristRotZ + tuning.wristRelax,
  };
}

function poseCashierAvatar(root: THREE.Object3D, tuning: CashierPoseTuning) {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((object) => {
    if ((object as THREE.Bone).isBone) {
      bones.set(object.name, object as THREE.Bone);
    }
  });
  const basePositions = getCashierBasePositions(root, bones);

  const setRotation = (name: string, x = 0, y = 0, z = 0) => {
    const bone = bones.get(name);
    if (!bone) return;
    bone.rotation.set(x, y, z);
  };

  const offsetBone = (name: string, x = 0, y = 0, z = 0) => {
    const bone = bones.get(name);
    const base = basePositions.get(name);
    if (!bone) return;
    if (base) bone.position.set(base.x + x, base.y + y, base.z + z);
    else bone.position.add(new THREE.Vector3(x, y, z));
  };

  const pose = resolveCashierArmaturePose(tuning);
  offsetBone("Left_shoulder", pose.shoulderX, pose.shoulderY, pose.shoulderZ);
  offsetBone("Right_shoulder", -pose.shoulderX, pose.shoulderY, pose.shoulderZ);
  offsetBone("Left_elbow", pose.elbowX, pose.elbowY, pose.elbowZ);
  offsetBone("Right_elbow", -pose.elbowX, pose.elbowY, pose.elbowZ);
  setRotation("Left_shoulder", pose.shoulderRotX, pose.shoulderRotY, pose.shoulderRotZ);
  setRotation("Right_shoulder", pose.shoulderRotX, -pose.shoulderRotY, -pose.shoulderRotZ);
  setRotation("Left_arm", pose.upperArmRotX, -pose.upperArmRotY, -pose.upperArmRotZ);
  setRotation("Right_arm", pose.upperArmRotX, pose.upperArmRotY, pose.upperArmRotZ);
  setRotation("Left_elbow", pose.elbowRotX, -pose.elbowRotY, -pose.elbowRotZ);
  setRotation("Right_elbow", pose.elbowRotX, pose.elbowRotY, pose.elbowRotZ);
  setRotation("Left_wrist", 0, 0, -pose.wristRotZ);
  setRotation("Right_wrist", 0, 0, pose.wristRotZ);
  setRotation("Spine", 0, 0, 0);
  setRotation("Chest", 0, 0, 0);
  setRotation("Head", 0, 0, 0);
  root.updateMatrixWorld(true);
}

function getCashierBasePositions(root: THREE.Object3D, bones: Map<string, THREE.Bone>): Map<string, THREE.Vector3> {
  if (!(root.userData.cashierBasePositions instanceof Map)) {
    root.userData.cashierBasePositions = new Map<string, THREE.Vector3>();
    bones.forEach((bone, name) => {
      root.userData.cashierBasePositions.set(name, bone.position.clone());
    });
  }
  return root.userData.cashierBasePositions as Map<string, THREE.Vector3>;
}

type MorphableMesh = THREE.Mesh & {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
};

type CashierBlinkController = {
  update: (elapsed: number) => void;
};

function createCashierBlinkController(root: THREE.Object3D): CashierBlinkController | undefined {
  const targets: Array<{ mesh: MorphableMesh; index: number }> = [];
  root.traverse((object) => {
    const mesh = object as MorphableMesh;
    if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    const closeIndex = mesh.morphTargetDictionary.Fcl_EYE_Close;
    if (typeof closeIndex === "number") targets.push({ mesh, index: closeIndex });
  });

  if (!targets.length) return undefined;

  let blinkStart = -1;
  let blinkRepeats = 1;
  let nextBlinkAt = randomBlinkDelay(0.8);
  const closeDuration = 0.055;
  const holdDuration = 0.028;
  const openDuration = 0.105;
  const blinkGap = 0.08;
  const blinkDuration = closeDuration + holdDuration + openDuration;
  const blinkCycleDuration = blinkDuration + blinkGap;

  const setBlink = (amount: number) => {
    targets.forEach(({ mesh, index }) => {
      if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = amount;
    });
  };

  return {
    update(elapsed) {
      if (blinkStart < 0 && elapsed >= nextBlinkAt) {
        blinkStart = elapsed;
        blinkRepeats = Math.random() < 0.16 ? 2 : 1;
      }

      if (blinkStart < 0) {
        setBlink(0);
        return;
      }

      const sequenceTime = elapsed - blinkStart;
      const blinkIndex = Math.floor(sequenceTime / blinkCycleDuration);
      if (blinkIndex >= blinkRepeats) {
        blinkStart = -1;
        nextBlinkAt = elapsed + randomBlinkDelay();
        setBlink(0);
        return;
      }

      const blinkTime = sequenceTime - blinkIndex * blinkCycleDuration;
      setBlink(blinkAmountAt(blinkTime, closeDuration, holdDuration, openDuration));
    },
  };
}

function blinkAmountAt(time: number, closeDuration: number, holdDuration: number, openDuration: number) {
  if (time < 0) return 0;
  if (time < closeDuration) return easeInOut(time / closeDuration);
  if (time < closeDuration + holdDuration) return 1;
  if (time < closeDuration + holdDuration + openDuration) {
    return 1 - easeInOut((time - closeDuration - holdDuration) / openDuration);
  }
  return 0;
}

function randomBlinkDelay(minimum = 1.9) {
  return minimum + Math.random() * 4.2;
}

function easeInOut(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function createFallbackCharacter(color: number, options: { cashier?: boolean } = {}): THREE.Group {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xffcaa8, roughness: 0.58 });
  const clothing = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b1a15, roughness: 0.62 });
  const apron = new THREE.MeshStandardMaterial({ color: options.cashier ? 0xffefd0 : 0xf7d9bd, roughness: 0.68 });

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.19, 0.48, 8, 20),
    clothing,
  );
  body.position.y = 0.78;

  const apronPanel = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.34, 0.025), apron);
  apronPanel.position.set(0, 0.8, -0.145);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 28, 28),
    skin,
  );
  head.position.y = 1.25;

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.145, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), dark);
  hair.position.y = 1.285;
  hair.rotation.x = -0.16;

  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x21120f });
  const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 10), eyeMaterial);
  leftEye.position.set(-0.045, 1.255, -0.126);
  const rightEye = leftEye.clone();
  rightEye.position.x = 0.045;

  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.006), new THREE.MeshBasicMaterial({ color: 0x7c3b35 }));
  mouth.position.set(0, 1.205, -0.132);

  const armMaterial = options.cashier ? clothing : skin;
  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.34, 6, 12), armMaterial);
  leftArm.position.set(-0.23, 0.84, -0.03);
  leftArm.rotation.z = -0.42;
  const rightArm = leftArm.clone();
  rightArm.position.x = 0.23;
  rightArm.rotation.z = 0.42;

  group.add(body, apronPanel, head, hair, leftEye, rightEye, mouth, leftArm, rightArm);
  return group;
}

function softenMaterial(material: THREE.Material | undefined) {
  if (!material) return;
  if ("roughness" in material) {
    (material as THREE.MeshStandardMaterial).roughness = 0.78;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
