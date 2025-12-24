(function () {
    const apps = new Map();
    const selectorCache = new Map();
    const components = new Map();
    const MAX_CACHE_SIZE = 1000;
    apps.count = 0;
    let globalKey = 0;
    const EVENT_TYPES = [];
    if (!CSS.escape) {
        CSS.escape = function (value) {
            return String(value).replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
        };
    }

    function isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
    }

    function findNodeByKey(nodes, key) {
        for (const node of nodes) {
            if (String(node._key) === key) return node;
            if (node.children && node.children.length > 0) {
                const found = findNodeByKey(node.children, key);
                if (found) return found;
            }
        }
        return null;
    }

    class VCollection {
        constructor(selector, app = null) {
            this.selectors = this.parseSelector(selector);
            this.items = [];
            this._findRecursive();
        }
    }
    Object.assign(VCollection.prototype, {
        css(style) {
            this.items.forEach(n => n.css(style).update());
            return this;
        },
        on(ev, h) {
            this.items.forEach(n => n.on(ev, h));
            return this;
        },
        update() {
            this.items.forEach(n => n.update());
            return this;
        },
        parseSelector(selector) {
            if (selectorCache.has(selector)) {
                return selectorCache.get(selector);
            }
            const parts = [];
            let currentPart = '';
            let inAttribute = false;
            let inPseudo = false;
            let inQuotes = false;
            let quoteChar = null;
            for (let i = 0; i < selector.length; i++) {
                const char = selector[i];
                if (inQuotes) {
                    currentPart += char;
                    if (char === quoteChar) {
                        inQuotes = false;
                        quoteChar = null;
                    }
                    continue;
                }
                if (char === '"' || char === "'") {
                    currentPart += char;
                    inQuotes = true;
                    quoteChar = char;
                    continue;
                }
                if (char === '[') {
                    inAttribute = true;
                    currentPart += char;
                    continue;
                }
                if (char === ']') {
                    inAttribute = false;
                    currentPart += char;
                    continue;
                }
                if (char === '(') {
                    inPseudo = true;
                    currentPart += char;
                    continue;
                }
                if (char === ')') {
                    inPseudo = false;
                    currentPart += char;
                    continue;
                }
                if (!inAttribute && !inPseudo && (char === ' ' || char === '>' || char === '+' || char === '~')) {
                    if (currentPart.trim()) {
                        parts.push(currentPart.trim());
                        currentPart = '';
                    }
                    if (char !== ' ') {
                        parts.push(char);
                    }
                    continue;
                }
                currentPart += char;
            }
            if (currentPart.trim()) {
                parts.push(currentPart.trim());
            }
            const parsedSelectors = [];
            let currentSelector = {tag: null, id: null, classes: [], attributes: [], pseudo: null};
            for (const part of parts) {
                if (part === ' ' || part === '>' || part === '+' || part === '~') {
                    continue;
                }
                let subPart = part;
                if (/^[a-zA-Z]/.test(subPart) && !subPart.startsWith('.') && !subPart.startsWith('#') && !subPart.startsWith('[')) {
                    currentSelector.tag = subPart.match(/^[a-zA-Z0-9-]+/)?.[0] || null;
                    subPart = subPart.slice(currentSelector.tag?.length || 0);
                }
                if (subPart.startsWith('#')) {
                    const match = subPart.match(/#([a-zA-Z0-9_-]+)/);
                    if (match) {
                        currentSelector.id = match[1];
                        subPart = subPart.slice(match[0].length);
                    }
                }
                const classMatches = subPart.match(/\.[a-zA-Z0-9_-]+/g);
                if (classMatches) {
                    currentSelector.classes = currentSelector.classes.concat(
                        classMatches.map(cls => cls.slice(1))
                    );
                    subPart = subPart.replace(/\.[a-zA-Z0-9_-]+/g, '');
                }
                const attrMatches = subPart.match(/\[([a-zA-Z0-9_-]+)([~|^$*]?=)?([^[\]]*)\]/g);
                if (attrMatches) {
                    currentSelector.attributes = currentSelector.attributes.concat(
                        attrMatches.map(attr => {
                            const match = attr.match(/\[([a-zA-Z0-9_-]+)([~|^$*]?=)?([^\]]*?)?\]/);
                            return {
                                name: match[1],
                                operator: match[2] || null,
                                value: match[3]?.replace(/^["']|["']$/g, '') || null
                            };
                        })
                    );
                    subPart = subPart.replace(/\[([a-zA-Z0-9_-]+)([~|^$*]?=)?([^\]]*?)?\]/g, '');
                }
                const pseudoMatches = subPart.match(/::?[a-zA-Z0-9_-]+/g);
                if (pseudoMatches) {
                    currentSelector.pseudo = pseudoMatches.join('');
                    subPart = subPart.replace(/::?[a-zA-Z0-9_-]+/g, '');
                }
                parsedSelectors.push({...currentSelector});
                currentSelector = {tag: null, id: null, classes: [], attributes: [], pseudo: null};
            }
            const result = parsedSelectors;
            if (selectorCache.size >= MAX_CACHE_SIZE) {
                const firstKey = selectorCache.keys().next().value;
                selectorCache.delete(firstKey);
            }
            selectorCache.set(selector, result);
            return result;
        },
        clearSelectorCache() {
            selectorCache.clear();
        },
        getCacheStats() {
            return {
                size: selectorCache.size,
                keys: Array.from(selectorCache.keys())
            };
        },
        _findRecursive() {
            const matches = (node, selector) => {
                if (selector.tag && node.tag !== selector.tag) return false;
                if (selector.id && node.props.id !== selector.id) return false;
                if (selector.classes.length > 0) {
                    const nodeClasses = (node.props.class || '').split(/\s+/);
                    if (!selector.classes.every(cls => nodeClasses.includes(cls))) return false;
                }
                if (selector.attributes.length > 0) {
                    for (const attr of selector.attributes) {
                        const nodeValue = node.props.attrs?.[attr.name];
                        if (nodeValue == null) return false;
                        if (attr.operator) {
                            switch (attr.operator) {
                                case '=':
                                    if (nodeValue !== attr.value) return false;
                                    break;
                                case '~=':
                                    if (!nodeValue.split(/\s+/).includes(attr.value)) return false;
                                    break;
                                case '|=':
                                    if (nodeValue !== attr.value && !nodeValue.startsWith(attr.value + '-')) return false;
                                    break;
                                case '^=':
                                    if (!nodeValue.startsWith(attr.value)) return false;
                                    break;
                                case '$=':
                                    if (!nodeValue.endsWith(attr.value)) return false;
                                    break;
                                case '*=':
                                    if (!nodeValue.includes(attr.value)) return false;
                                    break;
                            }
                        }
                    }
                }
                return true;
            };
            const traverse = (nodes) => {
                for (const node of nodes) {
                    for (const selector of this.selectors) {
                        if (matches(node, selector)) {
                            this.items.push(node);
                            break;
                        }
                    }
                    if (node.children && node.children.length > 0) {
                        traverse(node.children);
                    }
                }
            };
            apps.forEach(app => {
                traverse(app.children);
            });
        }
    });

    class VApp {
        constructor(selector) {
            this.id = apps.count++;
            this.selector = selector;
            this.element = document.querySelector(selector);
            this.children = [];
            this.handlers = new Map();
            apps.set(this.id, this);
            this._setupDelegation();
        }
    }
    Object.assign(VApp.prototype, {
        prepend(...nodes) {
            nodes.forEach(node => {
                node.parentId = this.id;
                if (node._key == null) {
                    node._key = numberToKey();
                }
                node.next = false;
            });
            this.children.unshift(...nodes);
            return this;
        },
        append(...nodes) {
            nodes.forEach(node => {
                node.parentId = this.id;
                if (node._key == null) {
                    node._key = numberToKey();
                }
                if (node.children) {
                    node.children.forEach(child => {
                        child.parentId = this.id;
                        if (child._key == null) {
                            child._key = numberToKey();
                        }
                    });
                }
            });
            this.children.push(...nodes);
            return this;
        },
        off(event = null) {
            this.children.forEach(node => {
                if (event) {
                    const prop = 'on' + event.charAt(0).toUpperCase() + event.slice(1);
                    delete node.props[prop];
                } else {
                    EVENT_TYPES.forEach(type => {
                        const prop = 'on' + type.charAt(0).toUpperCase() + type.slice(1);
                        delete node.props[prop];
                    });
                }
            });
            this.render();
            return this;
        },
        find(selector) {
            const results = [];
            const matches = this.element.querySelectorAll(selector);
            matches.forEach(el => {
                const key = el.getAttribute(':key');
                if (key) {
                    const node = findNodeByKey(this.children, key);
                    if (node) results.push(node);
                }
            });
            return new VCollection(results);
        },
        render() {
            const fragment = document.createDocumentFragment();
            const oldEls = Array.from(this.element.children);
            const newNodes = this.children;
            let i = 0, j = 0;
            while (i < oldEls.length && j < newNodes.length) {
                const oldEl = oldEls[i];
                const node = newNodes[j];
                const key = String(node._key);
                if (oldEl.getAttribute(':key') === key) {
                    updateElement(oldEl, node, this.handlers);
                    fragment.appendChild(oldEl);
                    i++;
                    j++;
                } else {
                    const matchIdx = oldEls.findIndex((el, idx) =>
                        idx >= i && el.getAttribute(':key') === key
                    );
                    if (matchIdx !== -1) {
                        const matched = oldEls.splice(matchIdx, 1)[0];
                        updateElement(matched, node, this.handlers);
                        fragment.appendChild(matched);
                        if (matchIdx < i) i--;
                        j++;
                    } else {
                        fragment.appendChild(createElement(node, this.handlers));
                        j++;
                    }
                }
            }
            while (j < newNodes.length) {
                fragment.appendChild(createElement(newNodes[j++], this.handlers));
            }
            while (i < oldEls.length) {
                const el = oldEls[i++];
                removeElementHandlers(el, this.handlers);
                el.remove();
            }
            this.element.innerHTML = '';
            this.element.appendChild(fragment);
        },
        renderAsync() {
            if (this._pendingRender) return;
            this._pendingRender = true;
            requestAnimationFrame(() => {
                this.render();
                this._pendingRender = false;
            });
        },
        destroy() {
            this.handlers.clear();
            apps.delete(this.id);
        },
        remove() {
            this.element.innerHTML = '';
            this.handlers.clear();
            this.children.forEach(node => node.remove());
            this.children = [];
            return this;
        },
        clear() {
            this.element.innerHTML = '';
            this.children = [];
            this.handlers.clear();
            return this;
        },
        mountComponent(component) {
            if (component instanceof VComponent) {
                component.parentId = this.id;
                this.children.push(component);
                this.render();
                setTimeout(() => component.mount(), 0);
            }
            return this;
        },
        _setupDelegation() {
            EVENT_TYPES.forEach(type => {
                this.element.addEventListener(type, e => {
                    const el = e.target.closest('[\\:key]');
                    if (!el) return;
                    const key = el.getAttribute(':key');
                    const handler = this.handlers.get(key)?.[type];
                    if (handler) handler(e);
                });
            });
            // Дополнительные слушатели для мобильной конвертации
            if (isMobile()) {
                // Хранение таймеров двойного касания для каждого элемента
                const dblTouchTimers = new Map();

                this.element.addEventListener('touchstart', e => {
                    const el = e.target.closest('[\\:key]');
                    if (!el) return;
                    const key = el.getAttribute(':key');

                    // Обработка одиночного касания (click)
                    const clickHandler = this.handlers.get(key)?.['click'];
                    if (clickHandler) {
                        e.preventDefault(); // Предотвращаем генерацию click события

                        // Проверяем на двойное касание
                        const existingTimer = dblTouchTimers.get(key);
                        if (existingTimer) {
                            clearTimeout(existingTimer);
                            dblTouchTimers.delete(key);

                            // Вызываем обработчик dblclick
                            const dblClickHandler = this.handlers.get(key)?.['dblclick'];
                            if (dblClickHandler) {
                                dblClickHandler(e);
                            }
                        } else {
                            // Запускаем таймер для двойного касания
                            const timer = setTimeout(() => {
                                dblTouchTimers.delete(key);
                                // Вызываем обработчик click
                                clickHandler(e);
                            }, 300); // 300ms - стандартное время двойного касания

                            dblTouchTimers.set(key, timer);
                        }
                    }
                });
            }
        }
    });

    class VNode {
        constructor(tag, props = {}) {
            this.tag = tag;
            this.props = {...props, content: props.content || ''};
            this.parentId = 0;
            this._key = props.key ? numberToKey(props.key) : numberToKey();
            this.children = [];
            this.next = true;
            this._template = null;
            this._templateData = {};
            this._templateReactive = false;
        }
    }
    Object.assign(VNode.prototype, {
        append(...nodes) {
            const app = apps.get(this.parentId);
            if (!app) return this;
            const newNodes = [];
            for (const node of nodes) {
                node.parentId = this.parentId;
                if (node._key == null) {
                    node._key = numberToKey();
                }
                node.next = false;
                newNodes.push(node);
            }
            this.children.push(...newNodes);
            this.update();
            return this;
        },
        css(style) {
            if (typeof this.props.style === 'string' && this.props.style.trim()) {
                const parsed = {};
                this.props.style.split(';').forEach(pair => {
                    const [k, v] = pair.split(':').map(s => s.trim());
                    if (k && v) {
                        const camelKey = k.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
                        parsed[camelKey] = v;
                    }
                });
                this.props.style = parsed;
            } else if (!this.props.style || typeof this.props.style !== 'object') {
                this.props.style = {};
            }
            if (typeof style === 'object' && style !== null) {
                Object.assign(this.props.style, style);
            } else if (typeof style === 'string' && style.trim()) {
                style.split(';').forEach(pair => {
                    const [k, v] = pair.split(':').map(s => s.trim());
                    if (k && v) {
                        const camelKey = k.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
                        this.props.style[camelKey] = v;
                    }
                });
            }
            return this;
        },
        attr(name, value) {
            this.props.attrs = this.props.attrs || {};
            if (typeof name === 'object') {
                Object.assign(this.props.attrs, name);
            } else {
                this.props.attrs[name] = value;
            }
            return this;
        },
        addClass(className) {
            const classes = (this.props.class || '').split(/\s+/).filter(c => c);
            if (!classes.includes(className)) {
                classes.push(className);
            }
            this.props.class = classes.join(' ');
            return this;
        },
        removeClass(className) {
            const classes = (this.props.class || '').split(/\s+/).filter(c => c && c !== className);
            this.props.class = classes.join(' ');
            return this;
        },
        text(content) {
            this.props.content = content;
            return this;
        },
        html(content) {
            this.props.content = content;
            return this;
        },
        on(event, handler) {
            const en = event.charAt(0).toUpperCase() + event.slice(1);
            if(!EVENT_TYPES.includes(en.toLowerCase())){
                EVENT_TYPES.push(en.toLowerCase());
            }
            const prop = 'on' + en;
            this.props[prop] = handler;
            return this;
        },
        off(event = null) {
            const app = apps.get(this.parentId);
            if (!app) return this;
            const key = String(this._key);
            if (event) {
                const prop = 'on' + event.charAt(0).toUpperCase() + event.slice(1);
                delete this.props[prop];
                const h = app.handlers.get(key);
                if (h) {
                    delete h[event];
                    if (!Object.keys(h).length) app.handlers.delete(key);
                }
            } else {
                app.handlers.delete(key);
            }
            return this;
        },
        update() {
            const app = apps.get(this.parentId);
            if (!app) return this;
            const escapedKey = CSS.escape(String(this._key));
            const selector = `[\\:key="${escapedKey}"]`;
            const el =
                app.element
                    .querySelector(selector) ||
                app.element
                    .querySelector(`[\\:key="${escapedKey}"]`)
                    ?.closest('[\\:key]')
                    ?.parentElement;
            if (!el) return this;
            const newEl = createElement(this, app.handlers);
            el.replaceWith(newEl);
            return this;
        },
        find(selector) {
            const app = apps.get(this.parentId);
            if (!app) return new VCollection();
            const rootEl = app.element.querySelector(`[\\:key="${CSS.escape(String(this._key))}"]`);
            if (!rootEl) return new VCollection();
            const results = [];
            const matches = rootEl.querySelectorAll(selector);
            matches.forEach(el => {
                const key = el.getAttribute(':key');
                if (key) {
                    const node = findNodeByKey([this], key);
                    if (node) results.push(node);
                }
            });
            return new VCollection(results);
        },
        parent() {
            const app = apps.get(this.parentId);
            if (!app) return null;
            for (const node of app.children) {
                if (node.children && node.children.includes(this)) {
                    return node;
                }
            }
            return null;
        },
        children() {
            return this.children || [];
        },
        remove() {
            const app = apps.get(this.parentId);
            if (!app) return this;
            let parent = null;
            for (const node of app.children) {
                if (node.children && node.children.includes(this)) {
                    parent = node;
                    break;
                }
            }
            if (parent) {
                parent.children = parent.children.filter(child => child !== this);
            } else {
                app.children = app.children.filter(child => child !== this);
            }
            app.handlers.delete(this._key);
            this.parentId = 0;
            this.children.forEach(child => child.remove());
            this.children = [];
            this.props = {};
            this.tag = null;
            return this;
        },
        clear() {
            const app = apps.get(this.parentId);
            if (!app) return this;
            const escapedKey = CSS.escape(String(this._key));
            const selector = `[\\:key="${escapedKey}"]`;
            const el = app.element.querySelector(selector);
            if (el) {
                el.innerHTML = '';
            }
            return this;
        },
        template(tmpl, data = {}) {
            this._template = tmpl;
            this._templateData = { ...data };
            this._applyTemplate();
            this.update();
            return this;
        },
        updateTemplate(key, value) {
            if (!this._templateData) return this;

            // Поддержка двух вариантов вызова: updateTemplate(key, value) и updateTemplate({ key: value })
            if (typeof key === 'object' && value === undefined) {
                // updateTemplate({ key1: value1, key2: value2 })
                const updates = key;
                let hasChanges = false;
                for (const [k, v] of Object.entries(updates)) {
                    const newValue = typeof v === 'function' ? v(this._templateData[k]) : v;
                    // Всегда обновляем, так как функции нельзя сравнивать корректно
                    if (typeof v === 'function' || this._templateData[k] !== newValue) {
                        this._templateData[k] = newValue;
                        hasChanges = true;
                    }
                }
                if (!hasChanges) return this;
            } else {
                // updateTemplate(key, value)
                const newValue = typeof value === 'function' ? value(this._templateData[key]) : value;
                if (typeof value === 'function' || this._templateData[key] !== newValue) {
                    this._templateData[key] = newValue;
                } else {
                    return this; // Нет изменений
                }
            }

            this._applyTemplate();
            return this;
        },
        _applyTemplate() {
            if (!this._template) return;

            // Обрабатываем шаблонные выражения
            let processedTemplate = this._template;

            // Заменяем {{expressions}} на значения из _templateData
            processedTemplate = processedTemplate.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
                const trimmedExpr = expr.trim();
                if (trimmedExpr.endsWith('()')) {
                    // Вызов метода
                    const methodName = trimmedExpr.slice(0, -2);
                    const method = this._templateData[methodName];
                    if (typeof method === 'function') {
                        try {
                            return method.call(this) || '';
                        } catch (e) {
                            console.warn('Method call error');
                            return '';
                        }
                    }
                } else {
                    // Обычное значение
                    const keys = trimmedExpr.split('.');
                    let result = this._templateData;
                    for (const key of keys) {
                        if (result && typeof result === 'object' && key in result) {
                            result = result[key];
                        } else {
                            result = undefined;
                            break;
                        }
                    }
                    // Для функций возвращаем специальный маркер
                    if (typeof result === 'function') {
                        return `__VDOM_FUNC_${trimmedExpr}__`;
                    }
                    return result !== undefined ? result : '';
                }
                return '';
            });

            const parse = new DOMParser();
            const doc = parse.parseFromString(processedTemplate, 'text/html');

            // Проверяем, есть ли дочерние элементы
            if (doc.body.children.length === 0) {
                // Если нет дочерних элементов, создаем текстовый контент
                const textContent = doc.body.textContent.trim();
                if (textContent) {
                    const textNode = new VNode('span');
                    textNode.props.content = textContent;
                    textNode._key = numberToKey();
                    this.children = [textNode];
                    return;
                }
            }

            // Функция для конвертации DOM элемента в VNode
            const elementToVNode = (el) => {
                const vnode = new VNode(el.tagName.toLowerCase());
                vnode.props.attrs = {};
                for (let attr of el.attributes) {
                    if (attr.name.startsWith(':on')) {
                        // Обработчик события
                        const eventName = attr.name.slice(3); // убираем ':on'
                        const handlerExpr = attr.value;

                        let handler;
                        // Проверяем, является ли выражение специальным маркером функции
                        if (handlerExpr.startsWith('__VDOM_FUNC_') && handlerExpr.endsWith('__')) {
                            const funcName = handlerExpr.slice(12).replace('__', ""); // убираем __VDOM_FUNC_ и __
                            const func = this._templateData[funcName];
                            if (typeof func === 'function') {
                                handler = (e) => func.call(this, e);
                            } else {
                                console.warn(`Function ${funcName} not found in template data`);
                            }
                        } else {
                            // Создаем функцию с правильным контекстом через замыкание
                            handler = ((node, data, expr) => {
                                return (e) => {
                                    try {
                                        const trimmed = expr.trim();
                                        // Check if it's a simple method call
                                        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed) && typeof data[trimmed] === 'function') {
                                            // Direct method call
                                            data[trimmed].call(node, e);
                                        } else {
                                            // Complex expression - wrap in parentheses to ensure it's an expression
                                            const func = new Function('$event', '$data', '$node', `with($data) { return (${expr}); }`);
                                            func.call(node, e, data, node);
                                        }
                                    } catch (error) {
                                        console.warn(`Event handler error: ${expr}`, error);
                                    }
                                };
                            })(this, this._templateData, handlerExpr);
                        }

                        if (handler) {
                            vnode.on(eventName, handler);
                        }
                    } else if (attr.name.startsWith(':')) {
                        // v-bind директива
                        const attrName = attr.name.slice(1);
                        const expr = attr.value;
                        try {
                            const func = new Function('$data', `with($data) { return ${expr} }`);
                            const value = func(this._templateData);
                            vnode.attr(attrName, value);
                        } catch (error) {
                            // If evaluation fails, treat as string literal
                            vnode.attr(attrName, expr);
                        }
                    } else {
                        // Обычный атрибут
                        vnode.props.attrs[attr.name] = attr.value;
                    }
                }
                vnode.props.content = el.textContent;
                vnode._key = numberToKey();
                // Рекурсивно обрабатываем дочерние элементы
                for (let child of el.children) {
                    vnode.children.push(elementToVNode(child));
                }
                return vnode;
            };

            // Очищаем текущие дочерние элементы и добавляем новые из парсера
            this.children = [];
            for (let child of doc.body.children) {
                this.children.push(elementToVNode(child));
            }
        },
        mountComponent(component) {
            if (component instanceof VComponent) {
                const app = apps.get(this.parentId);
                if (app) {
                    component.parentId = this.parentId;
                    this.children.push(component);
                    this.update();
                    setTimeout(() => component.mount(), 0);
                }
            }
            return this;
        }
    });

    class VClone {
        constructor(options = {}, count = 1) {
            this.nodes = this._clone(options, count);
        }
    }

    Object.assign(VClone.prototype, {
        _clone(options, count) {
            let _i = 0;
            const processTemplate = (value, templates, node, index) => {
                if (typeof value !== 'string' || !templates) return value;
                if (!/\{\{[^}]+\}\}/.test(value)) return value;
                return value.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
                    try {
                        let rawExpr = expr.trim();
                        const isCall = rawExpr.endsWith('()');
                        const key = isCall ? rawExpr.slice(0, -2) : rawExpr;
                        const fn = templates[key];
                        if (isCall && typeof fn === 'function') {
                            return fn(node, index);
                        } else if (!isCall) {
                            const keys = rawExpr.split('.');
                            let result = templates[keys[0]];
                            for (let i = 1; i < keys.length; i++) {
                                result = result?.[keys[i]];
                            }
                            return result !== undefined ? result : "";
                        }
                        return "";
                    } catch (e) {
                        console.warn(`Template error: ${expr}`, e);
                        return match;
                    }
                });
            };
            const htmlToVNodes = (html, templates, node, index) => {
                const processedHtml = processTemplate(html, templates, node, index);
                const temp = document.createElement('div');
                temp.innerHTML = processedHtml;
                const nodes = [];
                for (let i = 0; i < temp.children.length; i++) {
                    const el = temp.children[i];
                    const vnode = new VNode(el.tagName.toLowerCase());
                    vnode.props.attrs = {};
                    for (let attr of el.attributes) {
                        vnode.props.attrs[attr.name] = attr.value;
                    }
                    vnode.props.content = el.textContent;
                    if (vnode._key == null) {
                        vnode._key = numberToKey();
                    }
                    nodes.push(vnode);
                }
                return nodes;
            };
            let copy = function (obj, templates = {}, node = null, index = 0) {
                if (obj === null || typeof obj !== 'object') return obj;
                if (Array.isArray(obj)) {
                    return obj.map(item => copy(item, templates, node, index));
                }
                if (obj instanceof VNode) {
                    const clonedNode = new VNode(obj.tag, copy(obj.props, templates, node, index));
                    clonedNode.children = obj.children ? obj.children.map(child => copy(child, templates, node, index)) : [];
                    clonedNode._key = numberToKey();
                    return clonedNode;
                }
                let _obj = {};
                for (const key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        if (typeof obj[key] === 'object' && obj[key] !== null) {
                            _obj[key] = copy(obj[key], templates, node, index);
                        } else {
                            _obj[key] = processTemplate(obj[key], templates, node, index);
                        }
                    }
                }
                return _obj;
            };
            let cloned = [];
            for (let i = 0; i < count; i++) {
                _i = i;
                const node = new VNode(options.tag || 'div');
                node.props = copy(options.props || {}, options.templates || {}, node, i);
                EVENT_TYPES.forEach(type => {
                    const prop = 'on' + type.charAt(0).toUpperCase() + type.slice(1);
                    if (node.props[prop]) {
                        node.props[prop] = node.props[prop].bind(node);
                    }
                });
                node._key = numberToKey();
                if (options.children) {
                    node.children = options.children.map(child => {
                        let clonedChild;
                        if (child instanceof VNode) {
                            clonedChild = new VNode(child.tag, copy(child.props, options.templates || {}, node, i));
                            EVENT_TYPES.forEach(type => {
                                const prop = 'on' + type.charAt(0).toUpperCase() + type.slice(1);
                                if (clonedChild.props[prop]) {
                                    clonedChild.props[prop] = clonedChild.props[prop].bind(clonedChild);
                                }
                            });
                            clonedChild.children = child.children ? child.children.map(c => {
                                if (c instanceof VNode) {
                                    const cc = new VNode(c.tag, copy(c.props, options.templates || {}, node, i));
                                    EVENT_TYPES.forEach(type => {
                                        const prop = 'on' + type.charAt(0).toUpperCase() + type.slice(1);
                                        if (cc.props[prop]) {
                                            cc.props[prop] = cc.props[prop].bind(cc);
                                        }
                                    });
                                    cc._key = numberToKey();
                                    return cc;
                                } else {
                                    return copy(c, options.templates || {}, node, i);
                                }
                            }) : [];
                        } else {
                            clonedChild = child.clone ? child.clone() : copy(child, options.templates || {}, node, i);
                        }
                        clonedChild._key = numberToKey();
                        return clonedChild;
                    });
                }
                if (options.content !== undefined) {
                    if (typeof options.content === 'string') {
                        if (/<[a-z][\s\S]*>/i.test(options.content)) {
                            const vnodes = htmlToVNodes(options.content, options.templates || {}, node, i);
                            node.children = node.children || [];
                            node.children.push(...vnodes);
                        } else {
                            node.props.content = processTemplate(options.content, options.templates || {}, node, i);
                        }
                    } else if (Array.isArray(options.content)) {
                        node.children = node.children || [];
                        node.children.push(...options.content.map(c => {
                            const clonedC = c.clone ? c.clone() : c;
                            if (clonedC._key == null) clonedC._key = numberToKey();
                            return clonedC;
                        }));
                    } else if (options.content instanceof VNode) {
                        const clonedC = options.content.clone ? options.content.clone() : options.content;
                        if (clonedC._key == null) clonedC._key = numberToKey();
                        node.children = node.children || [];
                        node.children.push(clonedC);
                    } else {
                        node.props.content = processTemplate(options.content, options.templates || {}, node, i);
                    }
                }
                cloned.push(node);
            }
            return cloned;
        },
        get() {
            return this.nodes;
        },
        append(app) {
            if (app instanceof VApp) app.append(...this.nodes);
            return this;
        },
        update() {
            this.nodes.forEach(node => node.update());
            return this;
        },
        find(selector) {
            const results = [];
            for (const node of this.nodes) {
                const found = node.find(selector);
                if (found.items && found.items.length) {
                    results.push(...found.items);
                }
            }
            return new VCollection(results);
        },
        remove() {
            this.nodes.forEach(node => node.remove());
            this.nodes = [];
            return this;
        }
    });
    VClone.prototype[Symbol.iterator] = function () {
        return this.nodes[Symbol.iterator]();
    };


    class VComponent {
        constructor(name, options = {}, initialProps = {}) {
            this.name = name;
            this._key = numberToKey();
            this.parentId = 0;
            this.next = true;
            this.children = [];

            // Конфигурация компонента
            this.config = {
                template: options.template || '',
                props: {...(options.props || {})},
                events: {...(options.events || {})},
                methods: {...(options.methods || {})},
                listener: {...(options.listener || {})},
                computed: {...(options.computed || {})},
                watch: {...(options.watch || {})},
                provide: options.provide || {},
                inject: options.inject || {}
            };

            // Состояние компонента
            this.state = {
                isMounted: false,
                isDestroyed: false
            };

            // Инициализация систем
            this.props = {};
            this.$refs = {};
            this._refCallbacks = {};
            this._slotContent = {};
            this._computedCache = {};
            this._watchers = new Map();
            this._eventListeners = new Map();
            this._dependencies = new Map();
            this._delegateCounters = new Map(); // Счетчики вызовов делегатов

            // Инициализация
            this._initProps(initialProps);
            this._bindEvents();
            this._bindMethods();
            this._initComputed();
            this._initWatchers();
            this._initProvideInject();

            // Прослушка created
            this._callListener('created');

            // Применение шаблона
            this._applyTemplate();
        }
    }
    Object.assign(VComponent.prototype, {
        // ========== СИСТЕМА ПРОСЛУШКИ (LIFECYCLE) ==========
        _callListener: function(hookName, ...args) {
            const hook = this.config.listener[hookName];
            if (typeof hook === 'function') {
                try {
                    hook.call(this, ...args);
                } catch (error) {
                    console.error(`Error in ${hookName} listener:`, error);
                }
            }
        },

        // ========== ИНИЦИАЛИЗАЦИЯ PROPS ==========
        _initProps: function(initialProps) {
            for (const [key, defaultValue] of Object.entries(this.config.props)) {
                this.props[key] = initialProps[key] !== undefined ? initialProps[key] : defaultValue;
            }
            this._callListener('validating', this.props);
        },

        // ========== СИСТЕМА СОБЫТИЙ И МЕТОДОВ ==========
        _bindEvents: function() {
            for (const [eventName, handler] of Object.entries(this.config.events)) {
                if (typeof handler === 'function') {
                    this[`_event_${eventName}`] = handler.bind(this);
                    this[`_event_${eventName}`].__vdom_bound = true;
                }
            }
        },

        _bindMethods: function() {
            for (const [methodName, method] of Object.entries(this.config.methods)) {
                if (typeof method === 'function') {
                    this[methodName] = method.bind(this);
                    this[methodName].__vdom_bound = true;
                }
            }
        },

        // ========== COMPUTED СВОЙСТВА ==========
        _initComputed: function() {
            for (const [key, getter] of Object.entries(this.config.computed)) {
                if (typeof getter === 'function') {
                    Object.defineProperty(this, key, {
                        get: () => {
                            if (!this._computedCache[key] || this._dirty) {
                                this._currentComputed = key;
                                this._dependencies.set(key, new Set());
                                this._computedCache[key] = getter.call(this);
                                this._currentComputed = null;
                            }
                            return this._computedCache[key];
                        },
                        enumerable: true,
                        configurable: true
                    });
                }
            }
        },

        _invalidateComputed: function() {
            this._computedCache = {};
            this._dirty = true;
        },

        // ========== WATCHERS (НАБЛЮДАТЕЛИ) ==========
        _initWatchers: function() {
            for (const [path, watcher] of Object.entries(this.config.watch)) {
                if (typeof watcher === 'function') {
                    this._watchers.set(path, watcher.bind(this));
                }
            }
        },

        _triggerWatchers: function(propName, newValue, oldValue) {
            this._watchers.forEach((watcher, path) => {
                if (path === propName) {
                    watcher(newValue, oldValue);
                }
            });
        },

        _notifyDependencies: function(path) {
            this._dependencies.forEach((deps, computedKey) => {
                if (deps.has(path)) {
                    delete this._computedCache[computedKey];
                }
            });
        },

        // ========== PROVIDE/INJECT СИСТЕМА ==========
        _initProvideInject: function() {
            // Регистрируем провайдер
            if (this.config.provide && Object.keys(this.config.provide).length > 0) {
                this.provided = typeof this.config.provide === 'function' ?
                    this.config.provide.call(this) : this.config.provide;
                globalProviders.set(this._key, this);
            }

            // Внедряем зависимости
            this._resolveInjection();
        },

        _resolveInjection: function() {
            for (const [key, providerKey] of Object.entries(this.config.inject)) {
                for (const provider of globalProviders.values()) {
                    if (provider.provided && providerKey in provider.provided) {
                        this[key] = provider.provided[providerKey];
                        break;
                    }
                }
            }
        },

        // ========== СИСТЕМА ДЕЛЕГАТОВ ==========
        $delegate: function(methodName, ...args) {
            // Проверяем, есть ли ограничение на вызовы
            if (this._delegateCounters.has(methodName)) {
                const counter = this._delegateCounters.get(methodName);

                if (counter.remaining <= 0) {
                    console.log(`🚫 Delegate ${methodName} has reached call limit`);
                    return null;
                }

                // Уменьшаем счетчик
                counter.remaining--;

                // Если достигли лимита - удаляем
                if (counter.remaining === 0) {
                    this._delegateCounters.delete(methodName);
                }
            } else {
                console.log(`🔄 Delegating to ${methodName} (unlimited)`);
            }

            // Ищем метод в methods
            if (this.config.methods[methodName] && typeof this.config.methods[methodName] === 'function') {
                try {
                    return this.config.methods[methodName].apply(this, args);
                } catch (error) {
                    console.error(`Error in delegated method ${methodName}:`, error);
                    return null;
                }
            }
            // Ищем метод в events (для обратной совместимости)
            else if (this.config.events[methodName] && typeof this.config.events[methodName] === 'function') {
                try {
                    return this.config.events[methodName].apply(this, args);
                } catch (error) {
                    console.error(`Error in delegated event ${methodName}:`, error);
                    return null;
                }
            }
            else {
                console.warn(`Delegate method "${methodName}" not found in methods or events`);
                return null;
            }
        },

        $setDelegateLimit: function(methodName, maxCalls) {
            this._delegateCounters.set(methodName, {
                max: maxCalls,
                remaining: maxCalls
            });
            return this;
        },

        $removeDelegate: function(methodName) {
            if (this._delegateCounters.has(methodName)) {
                this._delegateCounters.delete(methodName);
            }
            return this;
        },

        $getDelegateInfo: function(methodName) {
            if (this._delegateCounters.has(methodName)) {
                const counter = this._delegateCounters.get(methodName);
                return {
                    maxCalls: counter.max,
                    remainingCalls: counter.remaining,
                    isActive: counter.remaining > 0
                };
            }
            return { isActive: true, maxCalls: Infinity, remainingCalls: Infinity };
        },

        $resetAllDelegates: function() {
            this._delegateCounters.clear();
            return this;
        },

        // ========== СИСТЕМА СОБЫТИЙ КОМПОНЕНТА ==========
        $emit: function(eventName, ...args) {
            const listeners = this._eventListeners.get(eventName) || [];
            listeners.forEach(listener => {
                try {
                    listener(...args);
                } catch (error) {
                    console.error(`Error in event listener ${eventName}:`, error);
                }
            });

            this._callListener('eventEmitted', eventName, args);
            return this;
        },

        $on: function(eventName, callback) {
            if (!this._eventListeners.has(eventName)) {
                this._eventListeners.set(eventName, []);
            }
            this._eventListeners.get(eventName).push(callback);
            return this;
        },

        $off: function(eventName, callback) {
            const listeners = this._eventListeners.get(eventName);
            if (listeners) {
                if (callback) {
                    this._eventListeners.set(eventName, listeners.filter(l => l !== callback));
                } else {
                    this._eventListeners.delete(eventName);
                }
            }
            return this;
        },

        // ========== СИСТЕМА ШАБЛОНОВ ==========
        _applyTemplate: function() {
            if (!this.config.template) {
                this.children = [];
                return;
            }

            try {
                let processedTemplate = this.config.template;

                // Обработка слотов
                processedTemplate = this._processSlots(processedTemplate);

                // Обработка директив
                processedTemplate = this._processDirectives(processedTemplate);

                // Компиляция шаблона
                processedTemplate = this._compileTemplate(processedTemplate);

                const parser = new DOMParser();
                const doc = parser.parseFromString(processedTemplate, 'text/html');

                this.children = [];
                for (let child of doc.body.children) {
                    this.children.push(this._elementToVNode(child));
                }
            } catch (error) {
                console.error('Template compilation error:', error);
                this.children = [];
            }
        },

        _processSlots: function(template) {
            return template.replace(/<slot\s+name="([^"]+)"[^>]*>([^<]*)<\/slot>/g,
                (match, slotName, defaultContent) => {
                    return this._slotContent[slotName] || defaultContent;
                });
        },

        _processDirectives: function(template) {
            let processed = template;

            // v-if директива
            processed = processed.replace(
                /<([a-zA-Z][^\s>]*)[^>]*\sv-if="([^"]+)"[^>]*>(.*?)<\/\1>/gs,
                (match, tag, condition, content) => {
                    const value = this._evaluateExpression(condition);
                    return value ? `<${tag}>${content}</${tag}>` : '';
                }
            );

            // v-show директива
            processed = processed.replace(
                /<([a-zA-Z][^\s>]*)[^>]*\sv-show="([^"]+)"[^>]*>/g,
                (match, tag, condition) => {
                    const value = this._evaluateExpression(condition);
                    const displayStyle = value ? '' : ' style="display: none;"';
                    return match.replace(/<([a-zA-Z][^\s>]*)/, `<$1${displayStyle}`);
                }
            );

            return processed;
        },

        _compileTemplate: function(template) {
            return template.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
                const key = expression.trim();

                // Ищем в props
                if (key in this.props) {
                    return this.props[key] != null ? String(this.props[key]) : '';
                }

                // Ищем в computed
                if (key in this.config.computed) {
                    const value = this[key];
                    return value != null ? String(value) : '';
                }

                return '';
            });
        },

        _evaluateExpression: function(expr) {
            try {
                // Создаем безопасный контекст для выражений
                const context = {
                    // Прямой доступ к свойствам
                    ...this.props,

                    // Доступ к computed свойствам
                    ...Object.keys(this.config.computed || {}).reduce((acc, key) => {
                        acc[key] = this[key];
                        return acc;
                    }, {})
                };

                // Формируем аргументы для Function
                const argNames = Object.keys(context);
                const argValues = Object.values(context);

                // Создаем и выполняем функцию
                const func = new Function(...argNames, `return ${expr}`);
                return func(...argValues);

            } catch (error) {
                console.warn(`Expression error: ${expr}`, error);
                return false;
            }
        },

        // ========== СИСТЕМА VNODE И REFS ==========
        _elementToVNode: function(element) {
            const vnode = new VNode(element.tagName.toLowerCase());
            vnode._key = numberToKey();

            // Обработка ref
            const refName = element.getAttribute('ref');
            if (refName) {
                this._refCallbacks[refName] = (el) => {
                    this.$refs[refName] = el;
                };
                element.removeAttribute('ref');
            }

            // Обработка атрибутов
            for (let attr of element.attributes) {
                this._processAttribute(vnode, attr.name, attr.value);
            }

            // Обработка содержимого
            if (element.children.length === 0 && element.textContent) {
                vnode.props.content = element.textContent;
            } else {
                for (let child of element.children) {
                    vnode.children.push(this._elementToVNode(child));
                }
            }

            return vnode;
        },

        _processAttribute: function(vnode, name, value) {
            if (name.startsWith('@')) {
                const eventName = name.slice(1);

                // Ищем сначала в events, потом в methods
                let handler = this.config.events[value];

                if (!handler && this.config.methods[value]) {
                    handler = this.config.methods[value];
                }

                if (typeof handler === 'function') {
                    vnode.on(eventName, handler.bind(this));
                }
            } else if (name === 'class') {
                vnode.addClass(value);
            } else {
                vnode.attr(name, value);
            }
        },

        _createElementWithRef: function(node, handlers) {
            const el = createElement(node, handlers);
            this._setRefs(el);
            return el;
        },

        _setRefs: function(el) {
            const setRefRecursive = (element, vnode) => {
                if (vnode._refCallbacks) {
                    Object.values(vnode._refCallbacks).forEach(callback => {
                        callback(element);
                    });
                }
                if (vnode.children && element.children) {
                    vnode.children.forEach((child, index) => {
                        const childEl = element.children[index];
                        if (childEl) {
                            setRefRecursive(childEl, child);
                        }
                    });
                }
            };
            setRefRecursive(el, this);
        },

        // ========== ПУБЛИЧНЫЕ МЕТОДЫ ==========
        setProps: function(newProps) {
            let hasChanges = false;
            const changes = {};

            for (const [key, value] of Object.entries(newProps)) {
                if (this.props[key] !== value) {
                    const oldValue = this.props[key];
                    this.props[key] = value;
                    changes[key] = { oldValue, newValue: value };
                    hasChanges = true;

                    // Прослушка beforeChange
                    this._callListener('beforeChange', key, value, oldValue);

                    // Уведомляем зависимости
                    this._notifyDependencies(key);

                    // Запускаем наблюдатели
                    this._triggerWatchers(key, value, oldValue);
                }
            }

            if (hasChanges) {
                this._invalidateComputed();
                this._callListener('beforeUpdate', changes);
                this._applyTemplate();
                this.update();
                this._callListener('updated', changes);
            }

            return this;
        },

        setSlot: function(slotName, content) {
            this._slotContent[slotName] = content;
            this._applyTemplate();
            this.update();
            return this;
        },

        // ========== ЖИЗНЕННЫЙ ЦИКЛ ==========
        update: function() {
            const app = apps.get(this.parentId);
            if (!app) return this;

            const escapedKey = CSS.escape(String(this._key));
            const selector = `[\\:key="${escapedKey}"]`;
            const el = app.element.querySelector(selector);

            if (el) {
                const newEl = this._createElementWithRef(this, app.handlers);
                el.replaceWith(newEl);
            }

            return this;
        },

        mount: function() {
            if (this.state.isMounted) return this;

            this._callListener('beforeMount');
            this.state.isMounted = true;
            this._callListener('mounted');
            return this;
        },

        unmount: function() {
            if (!this.state.isMounted || this.state.isDestroyed) return this;

            this._callListener('beforeUnmount');
            this.state.isMounted = false;
            this.state.isDestroyed = true;

            // Очистка
            this._eventListeners.clear();
            this._delegateCounters.clear();
            globalProviders.delete(this._key);

            const app = apps.get(this.parentId);
            if (app) {
                const escapedKey = CSS.escape(String(this._key));
                const selector = `[\\:key="${escapedKey}"]`;
                const el = app.element.querySelector(selector);
                if (el) {
                    removeElementHandlers(el, app.handlers);
                    el.remove();
                }
            }

            this._callListener('unmounted');
            return this;
        },

        forceUpdate: function() {
            this._invalidateComputed();
            this._callListener('beforeUpdate', { forced: true });
            this._applyTemplate();
            this.update();
            this._callListener('updated', { forced: true });
            return this;
        },

        // ========== СОВМЕСТИМОСТЬ С VNODE ==========
        append: function(...nodes) {
            const app = apps.get(this.parentId);
            if (!app) return this;

            nodes.forEach(node => {
                node.parentId = this.parentId;
                if (node._key == null) {
                    node._key = numberToKey();
                }
                node.next = false;
            });

            this.children.push(...nodes);
            this.update();
            return this;
        },

        remove: function() {
            return this.unmount();
        },

        find: function(selector) {
            const results = [];
            const search = (nodes) => {
                for (const node of nodes) {
                    if (this._matchesSelector(node, selector)) {
                        results.push(node);
                    }
                    if (node.children && node.children.length > 0) {
                        search(node.children);
                    }
                }
            };

            search(this.children);
            return new VCollection(results);
        },

        _matchesSelector: function(node, selector) {
            if (selector === node.tag) return true;
            if (selector.startsWith('.') && node.props.class?.includes(selector.slice(1))) return true;
            if (selector.startsWith('#') && node.props.id === selector.slice(1)) return true;
            return false;
        }
    });

    const globalProviders = new Map();
    const globalMixins = [];

    function createElement(node, handlers) {
        // Назначаем _key, если есть события
        if (node._key == null) {
            let hasEvents = false;
            for (const type of EVENT_TYPES) {
                const prop = 'on' + type.charAt(0).toUpperCase() + type.slice(1);
                if (node.props[prop]) {
                    hasEvents = true;
                    break;
                }
            }
            if (hasEvents) node._key = numberToKey();
        }

        if (node instanceof VComponent) {
            const el = document.createElement('div');
            el.setAttribute(':key', String(node._key));
            applyProps(el, node, handlers);
            el.innerHTML = '';
            node.children.forEach(child => {
                el.appendChild(createElement(child, handlers));
            });
            return el;
        }

        const el = document.createElement(node.tag);
        applyProps(el, node, handlers);
        return el;
    }
    // Сохраняем оригинальную функцию ДО ее переопределения
    const originalCreateElement = createElement;

    createElement = function(node, handlers) {
        if (node instanceof VComponent) {
            const el = document.createElement('div');
            el.setAttribute(':key', String(node._key));

            // Применяем базовые свойства как для обычного VNode
            const { id, class: cls, style, attrs, content } = node.props || {};

            if (id !== undefined) el.id = id;
            if (cls !== undefined) el.className = cls;

            // Применяем стили
            if (style) {
                if (typeof style === 'object') {
                    Object.assign(el.style, style);
                } else if (typeof style === 'string') {
                    el.style.cssText = style;
                }
            }

            // Применяем атрибуты
            if (attrs) {
                for (const [key, value] of Object.entries(attrs)) {
                    if (value !== false && value != null) {
                        el.setAttribute(key, value);
                    }
                }
            }

            // Обрабатываем контент
            if (content != null && node.children.length === 0) {
                if (typeof content === 'string' && /<[a-z]/i.test(content)) {
                    el.innerHTML = content;
                } else {
                    el.textContent = content;
                }
            } else {
                // Добавляем дочерние элементы
                el.innerHTML = '';
                node.children.forEach(child => {
                    el.appendChild(originalCreateElement(child, handlers));
                });
            }

            return el;
        }
        return originalCreateElement(node, handlers);
    };

    function updateElement(el, node, handlers) {
        applyProps(el, node, handlers);
    }

    function applyProps(el, node, handlers) {
        const {id, class: cls, attrs, content, key} = node.props;
        const style = node.props.style || {};  // ← вот так
        const nodeKey = String(node._key);
        if (id !== undefined) el.id = id; else el.removeAttribute('id');
        if (cls !== undefined) el.className = cls; else el.removeAttribute('class');
        const finalStyle = {};
        if (typeof node.props.style === 'object' && node.props.style) {
            Object.assign(finalStyle, node.props.style);
        }
        if (node.props.style != null) {
            if (typeof style === 'object') {
                Object.assign(finalStyle, style);
            } else if (typeof style === 'string' && style.trim()) {
                style.split(';').forEach(pair => {
                    const [k, v] = pair.split(':').map(s => s.trim());
                    if (k && v) {
                        const camelKey = k.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
                        finalStyle[camelKey] = v;
                    }
                });
            }
        }
        if (Object.keys(finalStyle).length > 0) {
            el.style.cssText = Object.entries(finalStyle)
                .map(([k, v]) => {
                    const kebabKey = k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
                    return `${kebabKey}: ${v}`;
                })
                .join('; ');
        } else {
            el.style.cssText = '';
        }
        el.setAttribute(':key', node._key);
        if (key !== undefined) el.setAttribute('key', key); else el.removeAttribute('key');
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                if (v === false || v == null) {
                    el.removeAttribute(k);
                } else {
                    el.setAttribute(k, v);
                }
            }
        }
        if (node.children && node.children.length > 0) {
            el.innerHTML = '';
            let data = content;
            const fragment = document.createDocumentFragment();
            node.children.forEach(child => {
                if (!child.next) {
                    fragment.prepend(createElement(child, handlers));
                    return;
                }
                if (data) {
                    fragment.append(data);
                    data = undefined;
                }
                fragment.appendChild(createElement(child, handlers));
            });
            el.appendChild(fragment);
        } else if (content != null) {
            if (typeof content === 'string' && /<[a-z]/i.test(content)) {
                el.innerHTML = content;
            } else {
                el.textContent = content;
            }
        } else {
            el.textContent = '';
        }
        const nodeHandlers = {};
        EVENT_TYPES.forEach(type => {
            const prop = `on${type.charAt(0).toUpperCase() + type.slice(1)}`;
            const handler = node.props[prop];
            if (handler) {
                if (handler.__vdom_bound) {
                    nodeHandlers[type] = handler; // ← уже привязан к компоненту
                } else {
                    nodeHandlers[type] = (e) => handler.call(node, e); // ← для ручных обработчиков
                }
            }
        });
        handlers.set(nodeKey, nodeHandlers);
    }

    function removeElementHandlers(el, handlers) {
        const key = el.getAttribute(':key');
        if (key) handlers.delete(key);
    }

    function numberToKey(value) {
        const num = value ? value : globalKey++;
        const length = num.toString().length + 1;
        return num.toString(36).padStart(length, 'a').slice(0, length);
    }

    const $v = (tag = 'div', props = {}) => new VNode(tag, props);
    $v.setup = (options = {}) => {
        if(options.events !== undefined && EVENT_TYPES.length < 1){
            options.events.forEach(ev => {
                EVENT_TYPES.push(ev);
            });
        }
    };
    $v.create = (selector, options = {}) => new VApp(selector, options);
    $v.find = (selector, app = null) => new VCollection(selector, app);
    $v.clone = (options = {}, count = 1) => new VClone(options, count);
    $v.debug = () => {
        console.group('VDOM:');
        console.log("Apps:", apps);
        console.log("Handlers:", [...apps.values()].map(a => a.handlers));
        console.groupEnd();
    };
    $v.free = (app = null) => {
        if (app instanceof VApp) app.clear();
        apps.clear();
        selectorCache.clear();
    };
    $v.mixin = (mixin) => {
        globalMixins.push(mixin);
        return $v;
    };
    $v.use = (plugin, options = {}) => {
        if (typeof plugin.install === 'function') {
            plugin.install($v, options);
        } else if (typeof plugin === 'function') {
            plugin($v, options);
        }
        return $v;
    };

    $v.createComponent = (name, config = {}) => {
        // Применяем глобальные миксины
        let mergedConfig = { ...config };

        globalMixins.forEach(mixin => {
            mergedConfig = {
                methods: { ...mixin.methods, ...mergedConfig.methods },
                listener: { ...mixin.listener, ...mergedConfig.listener },
                computed: { ...mixin.computed, ...mergedConfig.computed },
                watch: { ...mixin.watch, ...mergedConfig.watch },
                provide: { ...mixin.provide, ...mergedConfig.provide }
            };
        });

        components.set(name, mergedConfig);
        return mergedConfig;
    };
    $v.removeComponent = (name) => {
        components.delete(name);
        return true;
    };
    $v.component = (name, props = {}) => {
        const config = components.get(name);
        if (!config) {
            console.warn(`Component "${name}" not found`);
            return null;
        }

        const component = new VComponent(name, config, props);

        // Делаем ТОЛЬКО methods доступными публично
        Object.keys(config.methods || {}).forEach(methodName => {
            component[methodName] = function(...args) {
                if (component.config.methods[methodName]) {
                    return component.config.methods[methodName].apply(component, args);
                }
            };
        });

        return component;
    };

    window.$v = $v;
})();
