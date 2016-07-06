class Subscriber {
    constructor(fn, options, context) {
        var guidGenerator = ()=> {
            var S4 = ()=> {
                return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
            };
            return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
        };
        this.id = guidGenerator();
        this.fn = fn;
        this.options = options;
        this.context = context;
        this.channel = null;
    }

    update(options) {
        if (options) {
            this.fn = options.fn || this.fn;
            this.context = options.context || this.context;
            this.options = options.options || this.options;
            if (this.channel && this.options && this.options.priority !== undefined) {
                this.channel.setPriority(this.id, this.options.priority);
            }
        }
    }
}

class Channel {
    constructor(namespace, parent) {
        if (!(this instanceof Channel)) {
            return new Channel(namespace);
        }
        this.namespace = namespace || "";
        this._subscribers = [];
        this._channels = {};
        this._parent = parent;
        this.stopped = false;
    }

    addSubscriber(fn, options, context) {
        var subscriber = new Subscriber(fn, options, context);

        if (options && options.priority !== undefined) {
            options.priority = options.priority >> 0;
            if (options.priority < 0) {
                options.priority = 0;
            }
            if (options.priority >= this._subscribers.length) {
                options.priority = this._subscribers.length - 1;
            }
            this._subscribers.splice(options.priority, 0, subscriber);
        } else {
            this._subscribers.push(subscriber);
        }

        subscriber.channel = this;

        return subscriber;
    }

    stopPropagation() {
        this.stopped = true;
    }

    getSubscriber(identifier) {
        var x = 0,
                y = this._subscribers.length;

        for (x, y; x < y; x++) {
            if (this._subscribers[x].id === identifier || this._subscribers[x].fn === identifier) {
                return this._subscribers[x];
            }
        }
    }

    setPriority(identifier, priority) {
        var oldIndex = 0,
                x = 0,
                sub, firstHalf, lastHalf, y;

        for (x = 0, y = this._subscribers.length; x < y; x++) {
            if (this._subscribers[x].id === identifier || this._subscribers[x].fn === identifier) {
                break;
            }
            oldIndex++;
        }

        sub = this._subscribers[oldIndex];
        firstHalf = this._subscribers.slice(0, oldIndex);
        lastHalf = this._subscribers.slice(oldIndex + 1);

        this._subscribers = firstHalf.concat(lastHalf);
        this._subscribers.splice(priority, 0, sub);
    }

    addChannel(channel) {
        this._channels[channel] = new Channel((this.namespace ? this.namespace + ':' : '') + channel, this);
    }

    hasChannel(channel) {
        return this._channels.hasOwnProperty(channel);
    }

    returnChannel(channel) {
        return this._channels[channel];
    }

    removeSubscriber(identifier) {
        var x = this._subscribers.length - 1;

        if (!identifier) {
            this._subscribers = [];
            return;
        }

        for (x; x >= 0; x--) {
            if (this._subscribers[x].fn === identifier || this._subscribers[x].id === identifier) {
                this._subscribers[x].channel = null;
                this._subscribers.splice(x, 1);
            }
        }
    }

    publish(data) {
        var x = 0,
                y = this._subscribers.length,
                shouldCall = false,
                subscriber, l,
                subsBefore, subsAfter;

        // Priority is preserved in the _subscribers index.
        for (x, y; x < y; x++) {
            // By default set the flag to false
            shouldCall = false;
            subscriber = this._subscribers[x];

            if (!this.stopped) {
                subsBefore = this._subscribers.length;
                if (subscriber.options !== undefined && typeof subscriber.options.predicate === "function") {
                    if (subscriber.options.predicate.apply(subscriber.context, data)) {
                        // The predicate matches, the callback function should be called
                        shouldCall = true;
                    }
                } else {
                    // There is no predicate to match, the callback should always be called
                    shouldCall = true;
                }
            }

            // Check if the callback should be called
            if (shouldCall) {
                // Check if the subscriber has options and if this include the calls options
                if (subscriber.options && subscriber.options.calls !== undefined) {
                    // Decrease the number of calls left by one
                    subscriber.options.calls--;
                    // Once the number of calls left reaches zero or less we need to remove the subscriber
                    if (subscriber.options.calls < 1) {
                        this.removeSubscriber(subscriber.id);
                    }
                }
                // Now we call the callback, if this in turns publishes to the same channel it will no longer
                // cause the callback to be called as we just removed it as a subscriber
                subscriber.fn.apply(subscriber.context, data);

                subsAfter = this._subscribers.length;
                y = subsAfter;
                if (subsAfter === subsBefore - 1) {
                    x--;
                }
            }
        }

        if (this._parent) {
            this._parent.publish(data);
        }

        this.stopped = false;
    }

}

class Mediator {

    constructor() {
        this._channels = new Channel('');

        this.on = this.subscribe;
        this.bind = this.subscribe;
        this.emit = this.publish;
        this.trigger = this.publish;
        this.off = this.remove;
    }

    getChannel(namespace, readOnly) {
        var channel = this._channels,
                namespaceHierarchy = namespace.split(':'),
                x = 0,
                y = namespaceHierarchy.length;

        if (namespace === '') {
            return channel;
        }

        if (namespaceHierarchy.length > 0) {
            for (x, y; x < y; x++) {

                if (!channel.hasChannel(namespaceHierarchy[x])) {
                    if (readOnly) {
                        break;
                    } else {
                        channel.addChannel(namespaceHierarchy[x]);
                    }
                }

                channel = channel.returnChannel(namespaceHierarchy[x]);
            }
        }

        return channel;
    }

    subscribe(channelName, fn, options, context) {
        var channel = this.getChannel(channelName || "", false);

        options = options || {};
        context = context || {};

        return channel.addSubscriber(fn, options, context);
    }

    once(channelName, fn, options, context) {
        options = options || {};
        options.calls = 1;

        return this.subscribe(channelName, fn, options, context);
    }

    getSubscriber(identifier, channelName) {
        var channel = this.getChannel(channelName || "", true);
        // We have to check if channel within the hierarchy exists and if it is
        // an exact match for the requested channel
        if (channel.namespace !== channelName) {
            return null;
        }

        return channel.getSubscriber(identifier);
    }

    remove(channelName, identifier) {
        var channel = this.getChannel(channelName || "", true);
        if (channel.namespace !== channelName) {
            return false;
        }

        channel.removeSubscriber(identifier);
    }

    publish(channelName) {
        var channel = this.getChannel(channelName || "", true);
        if (channel.namespace !== channelName) {
            return null;
        }

        var args = Array.prototype.slice.call(arguments, 1);

        args.push(channel);

        channel.publish(args);
    }
}

export { Mediator }

