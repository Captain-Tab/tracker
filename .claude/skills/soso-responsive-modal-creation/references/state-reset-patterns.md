# 弹窗状态重置模式 - 详细参考

## 问题分析

### 为什么会出现数据残留？

NiceModal 使用 React 的组件复用机制：

1. **首次 open**：创建组件实例，执行 `useState` 初始化
2. **close（hide）**：组件隐藏但**不一定卸载**
3. **再次 open**：如果组件未卸载，`useState` 的初始值不会重新执行

```tsx
// ❌ 错误示例：状态只在首次渲染时初始化
const [count, setCount] = useState(0);
// 第一次 open: count = 0
// 增加到 5 后关闭
// 再次 open: count 仍然是 5（不是 0）
```

### 影响范围

| 场景 | 是否有残留风险 |
|------|--------------|
| useState 初始化 | ✅ 有风险 |
| useRef 初始化 | ✅ 有风险 |
| 组件内部的定时器 | ✅ 有风险（可能继续运行） |
| useEffect 清理函数 | ⚠️ 取决于依赖项 |
| 外部状态（MobX/Redux） | ❌ 无风险（独立管理） |

## 解决方案详解

### 方案 A：useEffect 监听 props 重置

**最推荐的方案**，适用于大多数场景。

```tsx
interface Props extends InjectModalProps {
  record?: RecordType;
  mode?: "create" | "edit";
}

const MyModal: React.FC<Props> = (props) => {
  const { record, mode } = props;
  
  // 状态定义
  const [formData, setFormData] = useState<FormData>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  // 核心：监听 props 变化重置状态
  useEffect(() => {
    // 根据 mode 和 record 初始化表单
    if (mode === "edit" && record) {
      setFormData({
        name: record.name,
        value: record.value,
      });
    } else {
      setFormData({});
    }
    // 清理其他状态
    setError(null);
    setLoading(false);
  }, [mode, record]);
  
  // ...
};
```

**优点**：
- 语义清晰，符合 React 数据流
- 可以精确控制哪些状态需要重置
- 支持根据不同 props 执行不同的初始化逻辑

**注意**：
- 确保依赖项数组完整
- 对于引用类型的 props，考虑使用 JSON.stringify 或 id 字段

### 方案 B：使用 key 强制重建组件

当组件状态复杂，难以手动重置时使用。

```tsx
// 调用方
const openModal = () => {
  myModal.open({
    _key: Date.now(),  // 或使用 uuid
    ...otherProps,
  });
};

// 组件内部
const MyModal: React.FC<Props> = (props) => {
  const { _key } = props;
  
  // 使用 key 触发完全重置
  const [resetKey, setResetKey] = useState(_key);
  
  useEffect(() => {
    if (_key !== resetKey) {
      // 重置所有状态
      setFormData({});
      setStep(0);
      setError(null);
      setResetKey(_key);
    }
  }, [_key, resetKey]);
  
  // ...
};
```

**优点**：
- 简单粗暴，一键重置所有状态
- 不需要逐个管理状态

**缺点**：
- 可能导致不必要的重渲染
- 失去对状态的精细控制

### 方案 C：onClose 清理状态

适用于需要在关闭时执行清理逻辑的场景。

```tsx
const MyModal: React.FC<Props> = (props) => {
  const { onClose } = props;
  
  const [formData, setFormData] = useState({});
  const [isDirty, setIsDirty] = useState(false);
  
  const handleClose = () => {
    // 询问是否保存更改
    if (isDirty) {
      // 可以弹出确认框
    }
    
    // 清理状态
    setFormData({});
    setIsDirty(false);
    
    // 调用外部 onClose
    onClose?.();
  };
  
  return (
    <div>
      {/* ... */}
      <button onClick={handleClose}>关闭</button>
    </div>
  );
};
```

**适用场景**：
- 需要在关闭前执行确认逻辑
- 需要清理定时器、取消请求等副作用

### 方案 D：使用 useModal 钩子监听

利用 NiceModal 的 `useModal` 钩子监听弹窗状态。

```tsx
import { useModal } from "@ebay/nice-modal-react";

const MyModal: React.FC<Props> = (props) => {
  const modal = useModal();
  const [formData, setFormData] = useState({});
  
  // 监听弹窗的 visible 状态
  useEffect(() => {
    if (modal.visible) {
      // 弹窗打开时初始化
      setFormData(props.initialData || {});
    }
  }, [modal.visible, props.initialData]);
  
  // 监听弹窗关闭
  useEffect(() => {
    if (!modal.visible) {
      // 弹窗关闭后清理
      return () => {
        setFormData({});
      };
    }
  }, [modal.visible]);
  
  // ...
};
```

## 实战示例

### 示例 1：编辑表单弹窗

```tsx
interface EditModalProps extends InjectModalProps {
  record: RecordType | null;
  onSuccess?: () => void;
}

const EditModal: React.FC<EditModalProps> = (props) => {
  const { record, onSuccess, resolve } = props;
  
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 关键：根据 record 初始化表单
  useEffect(() => {
    if (record) {
      setName(record.name || "");
      setEmail(record.email || "");
    } else {
      setName("");
      setEmail("");
    }
    setError(null);
    setSubmitting(false);
  }, [record]);
  
  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    
    try {
      await api.updateRecord({ name, email });
      onSuccess?.();
      resolve?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };
  
  return (
    <div>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      {error && <div className="text-red-500">{error}</div>}
      <button onClick={handleSubmit} disabled={submitting}>
        {submitting ? "保存中..." : "保存"}
      </button>
    </div>
  );
};
```

### 示例 2：多步骤流程弹窗

```tsx
interface ProcessModalProps extends InjectModalProps {
  initialStep?: number;
}

type Step = "input" | "confirm" | "processing" | "success" | "error";

const ProcessModal: React.FC<ProcessModalProps> = (props) => {
  const { initialStep = 0, resolve } = props;
  const modal = useModal();
  
  const [step, setStep] = useState<Step>("input");
  const [formData, setFormData] = useState({});
  const [result, setResult] = useState(null);
  
  // 弹窗打开时重置
  useEffect(() => {
    if (modal.visible) {
      setStep("input");
      setFormData({});
      setResult(null);
    }
  }, [modal.visible]);
  
  const handleProcess = async () => {
    setStep("processing");
    try {
      const res = await api.process(formData);
      setResult(res);
      setStep("success");
    } catch (e) {
      setStep("error");
    }
  };
  
  // 根据 step 渲染不同视图
  switch (step) {
    case "input":
      return <InputStep onNext={() => setStep("confirm")} />;
    case "confirm":
      return <ConfirmStep onConfirm={handleProcess} onBack={() => setStep("input")} />;
    case "processing":
      return <ProcessingStep />;
    case "success":
      return <SuccessStep result={result} onClose={() => resolve?.(result)} />;
    case "error":
      return <ErrorStep onRetry={() => setStep("input")} />;
  }
};
```

## 调试技巧

### 检测状态残留

```tsx
useEffect(() => {
  console.log("[MyModal] mounted/updated", {
    formData,
    props,
    timestamp: Date.now(),
  });
}, [formData, props]);

useEffect(() => {
  return () => {
    console.log("[MyModal] cleanup");
  };
}, []);
```

### 强制卸载测试

```tsx
// 临时修改，测试完成后删除
const [forceRemount, setForceRemount] = useState(0);

useEffect(() => {
  setForceRemount((prev) => prev + 1);
}, [props._testKey]);

if (forceRemount % 2 === 0) {
  return null; // 强制卸载
}
```
