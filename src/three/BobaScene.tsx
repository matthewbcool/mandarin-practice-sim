import { useEffect, useRef } from "react";
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { describeOrder } from "../game/menu";
import type { GamePhase, Order, Receipt } from "../game/types";

export type FocusTarget = "cashier" | "line" | "receipt" | "none";
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
  phase: GamePhase;
  listening: boolean;
  npcSpeaking: boolean;
  npcLine: string;
  playerSpeechLabel: string;
  playerSpeechText: string;
  pressure: number;
  currentOrder: Order;
  receipt?: Receipt;
  cashierPose: CashierPoseTuning;
  onFocusTargetChange: (target: FocusTarget) => void;
}

const WORLD_URL = "/assets/world/cozy-boba-shop.spz";
const COLLIDER_URL = "/assets/world/cozy-anime-boba-shop-collider.glb";
const CASHIER_URL = "/assets/characters/aki/aki-cashier.glb";
const CUSTOMER_URL = "/assets/characters/universal-base/Superhero_Male_FullBody.gltf";
const CASHIER_POS: [number, number, number] = [0, 0.097, -2];
const CASHIER_SCALE = 0.99;
const RECEIPT_GAZE_FOCUS_SECONDS = 0.9;
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
    const camera = new THREE.PerspectiveCamera(debug.fov, mount.clientWidth / mount.clientHeight, 0.02, 80);
    camera.position.set(debug.camera[0], debug.camera[1], debug.camera[2]);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = !debug.noXr;
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

    const spark = new SparkRenderer({ renderer });
    spark.frustumCulled = false;
    scene.add(spark);

    const splat = debug.simpleSplat ? new SplatMesh({}) : new SplatMesh({ url: WORLD_URL });
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
    }
    scene.add(splat);

    const focusObjects: THREE.Object3D[] = [];
    const animatedCharacters: THREE.Object3D[] = [];
    let cashierRoot: THREE.Object3D | undefined;
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

    const loader = new GLTFLoader();
    if (!debug.bare) loader.load(
      CASHIER_URL,
      (gltf) => {
        cashierRoot = gltf.scene;
        cashierRoot.name = "cashier";
        applyCashierRootPose(cashierRoot, propsRef.current.cashierPose);
        cashierRoot.rotation.y = 0;
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
      },
      undefined,
      () => {
        cashierRoot = createFallbackCharacter(0xffc3a5);
        applyCashierRootPose(cashierRoot, propsRef.current.cashierPose);
        cashierRoot.rotation.y = Math.PI;
        cashierRoot.userData.focusTarget = "cashier";
        focusObjects.push(cashierRoot);
        scene.add(cashierRoot);
        animatedCharacters.push(cashierRoot);
      },
    );

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

    loader.load(COLLIDER_URL, (gltf) => {
      gltf.scene.visible = false;
      gltf.scene.name = "world-collider";
      scene.add(gltf.scene);
    });

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
    let wasCelebrating = false;
    let receiptFocused = false;
    let receiptGazeStartedAt = -1;
    let receiptFocusAmount = 0;
    const counterDrinkPosition = new THREE.Vector3(0.58, 0.86, -0.88);
    const celebrationDrinkPosition = new THREE.Vector3(0, 1.08, -0.72);
    const receiptDrinkPosition = new THREE.Vector3(0, 1.08, -0.72);
    const receiptSidePosition = new THREE.Vector3(0.46, 1.18, -0.78);
    const receiptFocusedPosition = new THREE.Vector3();
    const receiptForward = new THREE.Vector3();
    const receiptSideQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.16, 0.018));

    const onResize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", onResize);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "r") {
        camera.position.set(debug.camera[0], debug.camera[1], debug.camera[2]);
        lookControls.reset(new THREE.Vector3(...debug.target));
      }
    };
    window.addEventListener("keydown", onKeyDown);

    const onPointerUp = () => {
      if (propsRef.current.phase === "receipt" && lastFocusTarget === "receipt") {
        receiptFocused = true;
      }
    };
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    renderer.setAnimationLoop(() => {
      const elapsed = clock.getElapsedTime();
      const state = propsRef.current;
      const receiptVisible = state.phase === "receipt" && Boolean(state.receipt);
      receiptDisplay.hitArea.visible = receiptVisible;
      lookControls.update();

      raycaster.setFromCamera(center, camera);
      const intersects = raycaster.intersectObjects(focusObjects, true);
      const focusHit = intersects.find((hit) => {
        const focus = hit.object.userData.focusTarget as FocusTarget | undefined;
        return focus !== "receipt" || receiptVisible;
      });
      const target = (focusHit?.object.userData.focusTarget as FocusTarget | undefined) ?? "none";
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
        cashierRoot.rotation.z = Math.sin(elapsed * 1.4) * 0.012;
        poseCashierAvatar(cashierRoot, state.cashierPose);
        cashierBlink?.update(elapsed);
      }

      animatedCharacters.forEach((character, index) => {
        if (character === cashierRoot) return;
        character.position.y = 0.02 + Math.sin(elapsed * 1.5 + index) * 0.006;
        character.rotation.z = Math.sin(elapsed * 1.2 + index) * 0.01;
      });

      exclamation.visible = target === "cashier" && state.listening;
      exclamation.scale.setScalar(0.34 + Math.sin(elapsed * 7) * 0.03);
      const celebrating = state.phase === "serving";
      if (celebrating && !wasCelebrating) confetti.start(elapsed);
      wasCelebrating = celebrating;
      confetti.update(elapsed);

      const drinkVisible = celebrating || receiptVisible;
      const drinkOpacity = receiptVisible ? 1 - receiptFocusAmount : 1;
      drink.visible = drinkVisible && drinkOpacity > 0.03;
      const targetDrinkPosition = celebrating ? celebrationDrinkPosition : receiptVisible ? receiptDrinkPosition : counterDrinkPosition;
      drink.position.lerp(targetDrinkPosition, 0.22);
      const receiptDrinkScale = THREE.MathUtils.lerp(1.42, 0.92, receiptFocusAmount);
      drink.scale.setScalar(celebrating ? 1.72 + Math.sin(elapsed * 5.5) * 0.035 : receiptVisible ? receiptDrinkScale : 1.1);
      drink.rotation.y = celebrating ? elapsed * 1.6 : receiptVisible ? Math.sin(elapsed * 1.2) * 0.08 : Math.sin(elapsed * 1.2) * 0.16;
      drink.rotation.z = celebrating ? Math.sin(elapsed * 4.2) * 0.035 : 0;
      setObjectOpacity(drink, drinkOpacity);

      receiptDisplay.group.visible = receiptVisible;
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

      const showGameplayPanels = ["ordering", "confirming", "paying", "serving"].includes(state.phase);
      npcBubble.sprite.visible = showGameplayPanels && Boolean(state.npcLine);
      if (npcBubble.sprite.visible && state.npcLine !== lastNpcText) {
        lastNpcText = state.npcLine;
        npcBubble.update(state.npcLine);
      }

      const orderText = describeOrder(state.currentOrder);
      const orderTitle = state.phase === "confirming" ? "確認中" : "目前聽到";
      orderPanel.sprite.visible = showGameplayPanels && state.phase !== "serving" && hasOrderContent(state.currentOrder);
      if (orderPanel.sprite.visible && (orderText !== lastOrderText || orderTitle !== lastOrderTitle)) {
        lastOrderText = orderText;
        lastOrderTitle = orderTitle;
        orderPanel.update(orderText, orderTitle);
      }

      const pressureText = `耐心 ${Math.max(0, 100 - state.pressure)}%`;
      pressurePanel.sprite.visible = showGameplayPanels && state.pressure > 14;
      if (pressurePanel.sprite.visible && pressureText !== lastPressureText) {
        lastPressureText = pressureText;
        pressurePanel.update(pressureText);
      }

      const speechText = state.playerSpeechText || (state.listening ? "請說話，我正在聽。" : "");
      const speechTitle = state.listening ? "正在聽" : state.playerSpeechLabel || "聽到";
      speechPanel.sprite.visible = showGameplayPanels && state.phase !== "serving" && Boolean(speechText);
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
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      lookControls.dispose();
      confetti.dispose();
      receiptDisplay.dispose();
      renderer.dispose();
      vrButton?.remove();
      mount.removeChild(renderer.domElement);
      delete (window as typeof window & { __bobaScene?: unknown }).__bobaScene;
    };
  }, []);

  return <div ref={mountRef} className="scene-canvas" />;
}

function getDebugParams() {
  const params = new URLSearchParams(window.location.search);
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
  };
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
    if (event.button !== 0 && event.pointerType === "mouse") return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    element.setPointerCapture(event.pointerId);
    element.classList.add("is-looking");
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
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
      smoothYaw = THREE.MathUtils.lerp(smoothYaw, yaw, 0.28);
      smoothPitch = THREE.MathUtils.lerp(smoothPitch, pitch, 0.28);
      applyRotation();
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
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.09, 0.36, 32, 1, true),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.28,
      roughness: 0.15,
      transmission: 0.4,
    }),
  );
  const tea = new THREE.Mesh(
    new THREE.CylinderGeometry(0.108, 0.083, 0.28, 32),
    new THREE.MeshStandardMaterial({ color: 0xc98956, roughness: 0.65 }),
  );
  tea.position.y = -0.025;
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.12, 0.035, 32),
    new THREE.MeshStandardMaterial({ color: 0xf6eadb, roughness: 0.35 }),
  );
  lid.position.y = 0.2;
  group.add(tea, cup, lid);
  for (let index = 0; index < 12; index += 1) {
    const pearl = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x2e1a12, roughness: 0.45 }),
    );
    pearl.position.set((Math.random() - 0.5) * 0.13, -0.16 + Math.random() * 0.055, (Math.random() - 0.5) * 0.13);
    group.add(pearl);
  }
  group.scale.setScalar(1.1);
  return group;
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
      material.transparent = true;
      material.opacity = baseOpacity * opacity;
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
