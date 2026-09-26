import React, { useState, useRef, useEffect } from 'react';
import { Modal, Input, Button, Space, Radio, InputNumber, Card, message, Alert, Spin, Typography, Divider, theme } from 'antd';
import { ThunderboltOutlined, CheckOutlined, ReloadOutlined, EditOutlined, LoadingOutlined } from '@ant-design/icons';
import { chapterApi } from '../services/api';
import { t } from '../i18n';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

interface PartialRegenerateModalProps {
  visible: boolean;
  chapterId: string;
  selectedText: string;
  startPosition: number;
  endPosition: number;
  styleId?: number;
  onClose: () => void;
  onApply: (newText: string, startPosition: number, endPosition: number) => void;
}

type LengthMode = 'similar' | 'expand' | 'condense' | 'custom';

/**
 * 局部重写弹窗组件
 * 用于配置和执行选中文本的AI重写
 */
export const PartialRegenerateModal: React.FC<PartialRegenerateModalProps> = ({
  visible,
  chapterId,
  selectedText,
  startPosition,
  endPosition,
  styleId,
  onClose,
  onApply,
}) => {
  const { token } = theme.useToken();
  const [userInstructions, setUserInstructions] = useState('');
  const [lengthMode, setLengthMode] = useState<LengthMode>('similar');
  const [customWordCount, setCustomWordCount] = useState<number>(selectedText.length);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedText, setGeneratedText] = useState('');
  const [hasGenerated, setHasGenerated] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const generatedTextRef = useRef<HTMLDivElement>(null);

  // 重置状态
  useEffect(() => {
    if (visible) {
      setUserInstructions('');
      setLengthMode('similar');
      setCustomWordCount(selectedText.length);
      setIsGenerating(false);
      setGeneratedText('');
      setHasGenerated(false);
      setProgress(0);
      setProgressMessage('');
    }
  }, [visible, selectedText.length]);

  // 自动滚动到底部
  useEffect(() => {
    if (generatedTextRef.current && isGenerating) {
      generatedTextRef.current.scrollTop = generatedTextRef.current.scrollHeight;
    }
  }, [generatedText, isGenerating]);

  const handleGenerate = async () => {
    if (!userInstructions.trim()) {
      message.warning(t('请输入重写要求'));
      return;
    }

    setIsGenerating(true);
    setGeneratedText('');
    setProgress(0);
    setProgressMessage(t('准备生成...'));

    // 创建 AbortController 用于取消请求
    abortControllerRef.current = new AbortController();

    try {
      await chapterApi.partialRegenerateStream(
        chapterId,
        {
          selected_text: selectedText,
          start_position: startPosition,
          end_position: endPosition,
          user_instructions: userInstructions,
          context_chars: 500,
          style_id: styleId,
          length_mode: lengthMode,
          target_word_count: lengthMode === 'custom' ? customWordCount : undefined,
        },
        {
          onProgress: (msg, prog) => {
            setProgress(prog);
            setProgressMessage(msg);
          },
          onChunk: (content) => {
            setGeneratedText(prev => prev + content);
          },
          onResult: () => {
            setProgress(100);
            setProgressMessage(t('生成完成'));
            setHasGenerated(true);
          },
          onError: (error) => {
            console.error('SSE错误:', error);
            message.error(error || t('生成过程中发生错误'));
          },
          onComplete: () => {
            setIsGenerating(false);
            setHasGenerated(true);
          },
        }
      );
    } catch (error) {
      console.error('生成失败:', error);
      if ((error as Error).name !== 'AbortError') {
        message.error(t('生成失败，请重试'));
      }
      setIsGenerating(false);
    }
  };

  const handleCancel = () => {
    if (isGenerating && abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
      message.info(t('已取消生成'));
    }
    onClose();
  };

  const handleAccept = async () => {
    if (!generatedText.trim()) {
      message.warning(t('没有可应用的内容'));
      return;
    }

    try {
      // 调用后端应用更改
      await chapterApi.applyPartialRegenerate(chapterId, {
        new_text: generatedText,
        start_position: startPosition,
        end_position: endPosition,
      });

      message.success(t('已应用重写内容'));
      onApply(generatedText, startPosition, endPosition);
      onClose();
    } catch (error) {
      console.error('应用失败:', error);
      message.error(t('应用失败，请重试'));
    }
  };

  const handleRegenerate = () => {
    setGeneratedText('');
    setHasGenerated(false);
    setProgress(0);
    setProgressMessage('');
    handleGenerate();
  };

  const getLengthModeDescription = (mode: LengthMode): string => {
    const descriptions: Record<LengthMode, string> = {
      similar: t('保持与原文相近的长度'),
      expand: t('扩展内容，增加更多细节'),
      condense: t('精简内容，保留核心要点'),
      custom: t('指定目标字数'),
    };
    return descriptions[mode];
  };

  return (
    <Modal
      title={
        <Space>
          <EditOutlined style={{ color: token.colorPrimary }} />
          <span>{t('AI局部重写')}</span>
        </Space>
      }
      open={visible}
      onCancel={handleCancel}
      width={800}
      centered
      maskClosable={!isGenerating}
      closable={!isGenerating}
      keyboard={!isGenerating}
      footer={
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={handleCancel} disabled={isGenerating}>
            {t('取消')}
          </Button>
          {!hasGenerated ? (
            <Button
              type="primary"
              icon={isGenerating ? <LoadingOutlined /> : <ThunderboltOutlined />}
              onClick={handleGenerate}
              loading={isGenerating}
              disabled={!userInstructions.trim()}
              style={{
                background: `linear-gradient(135deg, ${token.colorPrimary} 0%, ${token.colorPrimaryHover} 100%)`,
                border: 'none',
                boxShadow: token.boxShadowSecondary,
              }}
            >
              {isGenerating ? t('生成中...') : t('开始重写')}
            </Button>
          ) : (
            <>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRegenerate}
              >
                {t('重新生成')}
              </Button>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={handleAccept}
                style={{ background: token.colorSuccess, borderColor: token.colorSuccess }}
              >
                {t('接受并应用')}
              </Button>
            </>
          )}
        </Space>
      }
      styles={{
        body: {
          maxHeight: 'calc(100vh - 200px)',
          overflowY: 'auto',
        },
      }}
    >
      {/* 原文展示 */}
      <Card
        size="small"
        title={
          <Space>
            <Text strong>{t('原文内容')}</Text>
            <Text type="secondary">{t('({{selectedTextCount}}字)', { selectedTextCount: selectedText.length })}</Text>
          </Space>
        }
        style={{ marginBottom: 16 }}
        styles={{
          body: {
            maxHeight: 150,
            overflowY: 'auto',
            background: token.colorFillAlter,
          },
        }}
      >
        <Paragraph
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            color: token.colorText,
            lineHeight: 1.8,
          }}
        >
          {selectedText}
        </Paragraph>
      </Card>

      {/* 重写要求输入 */}
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          {t('重写要求')} <Text type="danger">*</Text>
        </Text>
        <TextArea
          value={userInstructions}
          onChange={(e) => setUserInstructions(e.target.value)}
          placeholder={t('请描述您希望如何重写这段内容，例如：&#10;- 让描写更加生动细腻&#10;- 增加环境氛围描写&#10;- 加强角色心理活动&#10;- 改变叙事节奏，更加紧凑&#10;- 添加对话内容')}
          rows={4}
          disabled={isGenerating}
          style={{ resize: 'none' }}
        />
      </div>

      {/* 长度模式选择 */}
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          {t('长度控制')}
        </Text>
        <Radio.Group
          value={lengthMode}
          onChange={(e) => setLengthMode(e.target.value)}
          disabled={isGenerating}
          buttonStyle="solid"
        >
          <Radio.Button value="similar">{t('保持长度')}</Radio.Button>
          <Radio.Button value="expand">{t('扩展内容')}</Radio.Button>
          <Radio.Button value="condense">{t('精简内容')}</Radio.Button>
          <Radio.Button value="custom">{t('自定义')}</Radio.Button>
        </Radio.Group>
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {getLengthModeDescription(lengthMode)}
          </Text>
        </div>
        {lengthMode === 'custom' && (
          <div style={{ marginTop: 12 }}>
            <Space>
              <Text>{t('目标字数：')}</Text>
              <InputNumber
                value={customWordCount}
                onChange={(value) => setCustomWordCount(value || selectedText.length)}
                min={10}
                max={10000}
                step={50}
                disabled={isGenerating}
                addonAfter={t('字')}
                style={{ width: 150 }}
              />
            </Space>
          </div>
        )}
      </div>

      <Divider style={{ margin: '16px 0' }} />

      {/* 生成结果展示 */}
      {(isGenerating || hasGenerated) && (
        <div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: 8 
          }}>
            <Space>
              <Text strong>{t('重写结果')}</Text>
              {generatedText && (
                <Text type="secondary">{t('({{generatedTextCount}}字)', { generatedTextCount: generatedText.length })}</Text>
              )}
            </Space>
            {isGenerating && (
              <Space>
                <Spin indicator={<LoadingOutlined style={{ fontSize: 14 }} spin />} />
                <Text type="secondary">{progressMessage || t('生成中...')}</Text>
              </Space>
            )}
          </div>

          {/* 进度条 */}
          {isGenerating && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  height: 4,
                  background: token.colorFillTertiary,
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: `linear-gradient(90deg, ${token.colorPrimary} 0%, ${token.colorPrimaryHover} 100%)`,
                    width: `${progress}%`,
                    transition: 'width 0.3s ease',
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>
          )}

          <Card
            size="small"
            ref={generatedTextRef}
            style={{
              background: generatedText ? token.colorSuccessBg : token.colorFillAlter,
              border: generatedText ? `1px solid ${token.colorSuccessBorder}` : `1px solid ${token.colorBorder}`,
            }}
            styles={{
              body: {
                maxHeight: 250,
                overflowY: 'auto',
                minHeight: 100,
              },
            }}
          >
            {generatedText ? (
              <Paragraph
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.8,
                }}
              >
                {generatedText}
                {isGenerating && (
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 16,
                      background: token.colorPrimary,
                      marginLeft: 2,
                      animation: 'blink 1s infinite',
                    }}
                  />
                )}
              </Paragraph>
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: token.colorTextTertiary }}>
                {isGenerating ? t('正在生成内容...') : t('等待生成...')}
              </div>
            )}
          </Card>

          {hasGenerated && generatedText && (
            <Alert
              message={t('生成完成')}
              description={
                <span>
                  {t('原文 {{selectedTextCount}} 字 → 新文 {{generatedTextCount}} 字', { selectedTextCount: selectedText.length, generatedTextCount: generatedText.length })}
                  {generatedText.length > selectedText.length && (
                    <Text type="success"> {t('(+{{v1}}字)', { v1: generatedText.length - selectedText.length })}</Text>
                  )}
                  {generatedText.length < selectedText.length && (
                    <Text type="warning"> {t('({{v1}}字)', { v1: generatedText.length - selectedText.length })}</Text>
                  )}
                </span>
              }
              type="success"
              showIcon
              style={{ marginTop: 12 }}
            />
          )}
        </div>
      )}

      {/* 添加闪烁光标动画 */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </Modal>
  );
};

export default PartialRegenerateModal;