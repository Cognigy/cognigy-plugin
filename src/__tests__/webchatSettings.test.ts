import { describe, it, expect } from '@jest/globals';
import { buildWebchatSettings, deepMerge } from '../tools/webchatSettings.js';

describe('deepMerge', () => {
  it('shallow merges flat objects', () => {
    const result = deepMerge({ a: 1, b: 2 }, { c: 3, d: 4 });
    expect(result).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });

  it('deep merges nested objects preserving untouched keys', () => {
    const target = { nested: { a: 1, b: 2, deep: { x: 10 } } };
    const source = { nested: { b: 99, deep: { y: 20 } } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ nested: { a: 1, b: 99, deep: { x: 10, y: 20 } } });
  });

  it('source overrides target for primitives', () => {
    const result = deepMerge({ a: 'old', b: 1 }, { a: 'new', b: 2 });
    expect(result).toEqual({ a: 'new', b: 2 });
  });

  it('replaces arrays instead of merging them', () => {
    const result = deepMerge({ items: [1, 2, 3] }, { items: [4, 5] });
    expect(result).toEqual({ items: [4, 5] });
  });

  it('skips undefined values in source', () => {
    const result = deepMerge({ a: 1, b: 2 }, { a: undefined, b: 3 });
    expect(result).toEqual({ a: 1, b: 3 });
  });

  it('null values in source overwrite target', () => {
    const result = deepMerge({ a: { nested: true }, b: 'keep' }, { a: null, b: 'keep' });
    expect(result).toEqual({ a: null, b: 'keep' });
  });

  it('empty source returns copy of target', () => {
    const target = { a: 1, b: { c: 2 } };
    const result = deepMerge(target, {});
    expect(result).toEqual(target);
    expect(result).not.toBe(target);
  });

  it('empty target returns copy of source', () => {
    const source = { a: 1, b: { c: 2 } };
    const result = deepMerge({}, source);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
  });
});

describe('buildWebchatSettings', () => {
  it('empty input returns only demoWebchat', () => {
    const result = buildWebchatSettings({} as any);
    expect(result).toEqual({ demoWebchat: { enabled: true } });
  });

  it('classic preset applies correct defaults', () => {
    const result = buildWebchatSettings({ stylePreset: 'classic' } as any);
    expect(result.layout).toEqual(
      expect.objectContaining({
        disableBotOutputBorder: false,
        botOutputMaxWidthPercentage: 73,
        chatWindowWidth: 460,
        enableInputCollation: false,
      }),
    );
    expect(result.colors).toEqual({ botMessageColor: '#ffffff' });
    expect(result.behavior).toEqual(
      expect.objectContaining({
        scrollingBehavior: 'alwaysScrollToBottom',
        collateStreamedOutputs: false,
        progressiveMessageRendering: false,
        renderMarkdown: true,
      }),
    );
  });

  it('modern preset applies correct defaults', () => {
    const result = buildWebchatSettings({ stylePreset: 'modern' } as any);
    expect(result.layout).toEqual(
      expect.objectContaining({
        disableBotOutputBorder: true,
        botOutputMaxWidthPercentage: 100,
        chatWindowWidth: 900,
        enableInputCollation: true,
      }),
    );
    expect(result.colors).toEqual({ botMessageColor: '#ffffff' });
    expect(result.behavior).toEqual(
      expect.objectContaining({
        scrollingBehavior: 'scrollUntilLastInputAtTop',
        collateStreamedOutputs: true,
        progressiveMessageRendering: true,
        renderMarkdown: true,
      }),
    );
  });

  it('slick preset applies correct defaults', () => {
    const result = buildWebchatSettings({ stylePreset: 'slick' } as any);
    expect(result.layout).toEqual(
      expect.objectContaining({
        disableBotOutputBorder: false,
        botOutputMaxWidthPercentage: 100,
        chatWindowWidth: 600,
        enableInputCollation: true,
      }),
    );
    expect(result.colors).toEqual({ botMessageColor: '#cccccc' });
    expect(result.behavior).toEqual(
      expect.objectContaining({
        scrollingBehavior: 'scrollUntilLastInputAtTop',
        collateStreamedOutputs: true,
        progressiveMessageRendering: false,
        renderMarkdown: true,
      }),
    );
  });

  it('user overrides take precedence over preset values', () => {
    const result = buildWebchatSettings({
      stylePreset: 'classic',
      layout: { chatWindowWidth: 800, colors: { agentMessageBg: '#ff0000' } },
      behavior: { renderMarkdown: false },
    } as any);
    expect(result.layout).toEqual(
      expect.objectContaining({
        chatWindowWidth: 800,
        disableBotOutputBorder: false,
        botOutputMaxWidthPercentage: 73,
        enableInputCollation: false,
      }),
    );
    expect(result.colors).toEqual({ botMessageColor: '#ff0000' });
    expect(result.behavior).toEqual(
      expect.objectContaining({ renderMarkdown: false }),
    );
  });

  it('maps color fields correctly', () => {
    const result = buildWebchatSettings({
      layout: {
        colors: {
          primaryColor: '#111',
          secondaryColor: '#222',
          chatBackground: '#333',
          agentMessageBg: '#444',
          userMessageBg: '#555',
          textLink: '#666',
        },
      },
    } as any);
    expect(result.colors).toEqual({
      primaryColor: '#111',
      secondaryColor: '#222',
      chatInterfaceColor: '#333',
      botMessageColor: '#444',
      userMessageColor: '#555',
      textLinkColor: '#666',
    });
  });

  it('maps layout fields correctly', () => {
    const result = buildWebchatSettings({
      layout: {
        title: 'Bot',
        maxInputRows: 5,
        botOutputMaxWidth: 80,
        enableGenericHtml: true,
        allowJsInHtml: true,
        botAvatarLogoUrl: 'https://img.png',
        humanAvatarName: 'Agent',
      },
    } as any);
    expect(result.layout).toEqual(
      expect.objectContaining({
        title: 'Bot',
        inputAutogrowMaxRows: 5,
        botOutputMaxWidthPercentage: 80,
        enableGenericHTMLStyling: true,
        disableHtmlContentSanitization: true,
        botLogoUrl: 'https://img.png',
        agentAvatarName: 'Agent',
      }),
    );
  });

  it('maps behavior fields correctly', () => {
    const result = buildWebchatSettings({
      behavior: {
        enableStt: true,
        enableTts: false,
        collectMetadata: true,
        displayAIAgentNotice: true,
        aiAgentNoticeText: 'Powered by AI',
      },
    } as any);
    expect(result.behavior).toEqual(
      expect.objectContaining({
        enableSTT: true,
        enableTTS: false,
        enableCollectMetadata: true,
        enableAIAgentNotice: true,
        AIAgentNoticeText: 'Powered by AI',
      }),
    );
  });

  it('maps scrolling behavior values', () => {
    const always = buildWebchatSettings({
      behavior: { scrollingBehavior: 'alwaysScroll' },
    } as any);
    expect(always.behavior.scrollingBehavior).toBe('alwaysScrollToBottom');

    const lastInput = buildWebchatSettings({
      behavior: { scrollingBehavior: 'scrollToLastInput' },
    } as any);
    expect(lastInput.behavior.scrollingBehavior).toBe('scrollUntilLastInputAtTop');
  });

  it('maps start behavior modes and payload fields', () => {
    const modes: Array<[string, string]> = [
      ['textField', 'none'],
      ['button', 'button'],
      ['autoSend', 'autoSend'],
    ];
    for (const [input, expected] of modes) {
      const result = buildWebchatSettings({
        startBehavior: { mode: input },
      } as any);
      expect(result.startBehavior.startBehavior).toBe(expected);
    }

    const result = buildWebchatSettings({
      startBehavior: {
        mode: 'button',
        textPayload: 'hi',
        dataPayload: { key: 'val' },
        displayText: 'Hello!',
        buttonTitle: 'Start',
      },
    } as any);
    expect(result.startBehavior).toEqual({
      startBehavior: 'button',
      getStartedPayload: 'hi',
      getStartedData: { key: 'val' },
      getStartedText: 'Hello!',
      getStartedButtonText: 'Start',
    });
  });

  it('maps home screen with background, starters, and previous conversations', () => {
    const result = buildWebchatSettings({
      homeScreen: {
        enabled: true,
        welcomeText: 'Welcome!',
        backgroundImage: 'https://bg.png',
        backgroundColor: '#fff',
        startConversationButtonText: 'Go',
        conversationStarters: [
          { title: 'Help', type: 'postback', value: 'help_payload' },
          { title: 'Website', type: 'url', value: 'https://example.com' },
        ],
        previousConversations: {
          enabled: true,
          enableDeleteAll: true,
          buttonText: 'History',
          title: 'Previous',
          startNewButtonText: 'New Chat',
        },
      },
    } as any);
    expect(result.homeScreen).toEqual({
      enabled: true,
      welcomeText: 'Welcome!',
      background: { imageUrl: 'https://bg.png', color: '#fff' },
      startConversationButtonText: 'Go',
      conversationStarters: {
        enabled: true,
        starters: [
          { title: 'Help', type: 'postbackValue', postbackValue: 'help_payload' },
          { title: 'Website', type: 'url', url: 'https://example.com' },
        ],
      },
      previousConversations: {
        enabled: true,
        enableDeleteAllConversations: true,
        buttonText: 'History',
        title: 'Previous',
        startNewConversationButtonText: 'New Chat',
      },
    });
  });

  it('maps teaser message with text, showInChat, and starters', () => {
    const result = buildWebchatSettings({
      teaserMessage: {
        text: 'Hey there!',
        showInChat: true,
        conversationStarters: [
          { title: 'FAQ', type: 'postback', value: 'faq' },
        ],
      },
    } as any);
    expect(result.teaserMessage).toEqual({
      text: 'Hey there!',
      showInChat: true,
      conversationStarters: {
        enabled: true,
        starters: [{ title: 'FAQ', type: 'postbackValue', postbackValue: 'faq' }],
      },
    });
  });

  it('maps chat options: quickReplies, textToSpeech, rating, footer', () => {
    const result = buildWebchatSettings({
      chatOptions: {
        enabled: true,
        title: 'Options',
        enableDeleteConversation: true,
        quickReplies: {
          enabled: true,
          sectionTitle: 'Quick',
          items: [{ title: 'Hi', type: 'postback', value: 'hi' }],
        },
        textToSpeech: {
          showToggle: true,
          activateByDefault: false,
          toggleLabel: 'TTS',
        },
        rating: {
          enabled: true,
          titleText: 'Rate us',
          commentPlaceholder: 'Comment...',
          submitButtonText: 'Send',
          submittedBannerText: 'Thanks!',
        },
        footer: {
          enabled: true,
          items: [{ title: 'Terms', url: 'https://terms.com' }],
        },
      },
    } as any);

    expect(result.chatOptions).toEqual({
      enabled: true,
      title: 'Options',
      enableDeleteConversation: true,
      quickReplyOptions: {
        enabled: true,
        sectionTitle: 'Quick',
        quickReplies: [{ title: 'Hi', type: 'postbackValue', postbackValue: 'hi' }],
      },
      showTTSToggle: true,
      activateTTSToggle: false,
      labelTTSToggle: 'TTS',
      rating: {
        enabled: 'once',
        title: 'Rate us',
        commentPlaceholder: 'Comment...',
        submitButtonText: 'Send',
        eventBannerText: 'Thanks!',
      },
      footer: {
        enabled: true,
        items: [{ title: 'Terms', url: 'https://terms.com' }],
      },
    });
  });

  it('maps rating enabled:false to "never"', () => {
    const result = buildWebchatSettings({
      chatOptions: { rating: { enabled: false } },
    } as any);
    expect(result.chatOptions.rating.enabled).toBe('never');
  });

  it('maps privacy notice fields', () => {
    const result = buildWebchatSettings({
      privacyNotice: {
        enabled: true,
        title: 'Privacy',
        text: 'We collect data.',
        submitButton: 'Accept',
        policyLinkTitle: 'Policy',
        policyLinkUrl: 'https://policy.com',
      },
    } as any);
    expect(result.privacyNotice).toEqual({
      enabled: true,
      title: 'Privacy',
      text: 'We collect data.',
      submitButtonText: 'Accept',
      urlText: 'Policy',
      url: 'https://policy.com',
    });
  });

  it('maps business hours with schedule and field renames', () => {
    const result = buildWebchatSettings({
      businessHours: {
        enabled: true,
        mode: 'hide',
        informationText: 'Closed',
        informationTitle: 'Hours',
        timezone: 'Europe/Berlin',
        schedule: [
          { dayOfWeek: 'monday', startTime: '09:00', endTime: '17:00' },
          { dayOfWeek: 'tuesday', startTime: '10:00', endTime: '18:00' },
        ],
      },
    } as any);
    expect(result.businessHours).toEqual({
      enabled: true,
      mode: 'hide',
      text: 'Closed',
      title: 'Hours',
      timeZone: 'Europe/Berlin',
      times: [
        { weekDay: 'monday', startTime: '09:00', endTime: '17:00' },
        { weekDay: 'tuesday', startTime: '10:00', endTime: '18:00' },
      ],
    });
  });

  it('maps unread messages with enableTitleIndicator → enableIndicator', () => {
    const result = buildWebchatSettings({
      unreadMessages: {
        enableTitleIndicator: true,
        enableBadge: false,
        enablePreview: true,
        enableSound: false,
      },
    } as any);
    expect(result.unreadMessages).toEqual({
      enableIndicator: true,
      enableBadge: false,
      enablePreview: true,
      enableSound: false,
    });
  });

  it('maps maintenance settings', () => {
    const result = buildWebchatSettings({
      maintenance: {
        enabled: true,
        mode: 'inform',
        informationText: 'Under maintenance',
        informationTitle: 'Maintenance',
      },
    } as any);
    expect(result.maintenance).toEqual({
      enabled: true,
      mode: 'inform',
      text: 'Under maintenance',
      title: 'Maintenance',
    });
  });

  it('places watermark fields into layout group', () => {
    const result = buildWebchatSettings({
      watermark: { type: 'custom', text: 'Powered by Us', url: 'https://us.com' },
    } as any);
    expect(result.layout).toEqual(
      expect.objectContaining({
        watermark: 'custom',
        watermarkText: 'Powered by Us',
        watermarkUrl: 'https://us.com',
      }),
    );
  });

  it('maps webchat icon animation and speed', () => {
    const speedCases: Array<[string, number]> = [
      ['slow', 0.5],
      ['normal', 1],
      ['fast', 2],
      ['superfast', 3],
    ];
    for (const [speed, expected] of speedCases) {
      const result = buildWebchatSettings({
        webchatIcon: { animation: 'bounce', animationInterval: 5000, animationSpeed: speed },
      } as any);
      expect(result.layout.iconAnimation).toBe('bounce');
      expect(result.layout.iconAnimationInterval).toBe(5000);
      expect(result.layout.iconAnimationSpeed).toBe(expected);
    }
  });

  it('unknown animation speed defaults to 1', () => {
    const result = buildWebchatSettings({
      webchatIcon: { animationSpeed: 'ludicrous' },
    } as any);
    expect(result.layout.iconAnimationSpeed).toBe(1);
  });

  it('places persistent menu into layout group', () => {
    const result = buildWebchatSettings({
      persistentMenu: {
        enabled: true,
        title: 'Menu',
        items: [
          { title: 'Help', payload: 'help' },
          { title: 'Restart', payload: 'restart' },
        ],
      },
    } as any);
    expect(result.layout).toEqual(
      expect.objectContaining({
        enablePersistentMenu: true,
        persistentMenu: {
          title: 'Menu',
          menuItems: [
            { title: 'Help', payload: 'help' },
            { title: 'Restart', payload: 'restart' },
          ],
        },
      }),
    );
  });

  it('maps attachment upload to fileStorageSettings', () => {
    const result = buildWebchatSettings({
      attachmentUpload: { enabled: true, dropzoneText: 'Drop files here' },
    } as any);
    expect(result.fileStorageSettings).toEqual({
      enabled: true,
      dropzoneText: 'Drop files here',
    });
  });

  it('maps customJson to customJSON', () => {
    const json = { theme: 'dark', version: 2 };
    const result = buildWebchatSettings({ customJson: json } as any);
    expect(result.customJSON).toEqual(json);
  });
});
