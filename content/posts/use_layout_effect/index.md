---
title: "Swapping parent element in React and keeping child state"
date: 2023-10-19T22:57:36+03:00
draft: false
tags:
  - Development
  - React
summary: How to keep state of a children component when swapping parent wrapper in React. A way to create reusable components parts. Unusual case of using two pass rendering and "useLayoutEffect"
---

There are not many usecases for `useLayoutEffect` in `React`, but recently I stumbled upon one such case.

Consider we have some `<Layout title="some title" />` component. Also this component has some internal state, like counter or something that we want to preserve. Also we have multiple elements that all use `Layout` to render its content:

```react
const BlockA = () => {
  return <Layout title="Block A" />
}

const BlockB = () => {
  return <Layout title="Block B" />
}

const Root = ({condition}: {condition: boolean}) => {
  return condition ? <BlockA /> : <BlockB />
}
```

__You can skip the article and go straight to [final result](#final-result)__

We have a problem. Each time we switch from `BlockA` to `BlockB` we lose `Layout` state. [Reconciliation guide](https://react.dev/learn/preserving-and-resetting-state#different-components-at-the-same-position-reset-state) clearly says that when parent element changes then children gets remounted.

As we can see both `BlockA` to `BlockB` are what I would call `transient` components, i.e. they output some other element with adding nothing to the DOM. What we need from them is just to generate some data that we would pass to `Layout`. Basically we can call them as function and it would work:

```react
const BlockA = () => {
  return <Layout title="Block A" />
}

const BlockB = () => {
  return <Layout title="Block B" />
}

const Root = ({condition}: {condition: boolean}) => {
  return condition ? BlockA() : BlockB()
}
```

But here is a problem. What if we use hooks in `Block#` components? If hooks in both differ the app will crash because we violated rule of hooks.

```react
const BlockA = () => {
  return <Layout title="Block A" />
}

const BlockB = () => {
  const title = useSelector(titleSelector)

  return <Layout title={title} />
}

const Root = ({condition}: {condition: boolean}) => {
  return condition ? BlockA() : BlockB() // crash when switching
}
```

OK, let us try to generalize `Block#` component so we dont have to repeat `Layout` declaration

```react
const BlockA = ({render}) => {
  return render({title: "Block A"})
}

const BlockB = ({render}) => {
  const title = useSelector(titleSelector)

  return render({title})
}

const Root = ({condition}: {condition: boolean}) => {
  const render = ({title}) => <Layout title={title} />
  return condition ? <BlockA render={render} /> : <BlockB render={render} />
}
```

Now let's make generalized component for such components that use `render` prop:

```react
const BlockA = ({render}) => {
  return render({title: "Block A"})
}

const BlockB = ({render}) => {
  const title = useSelector(titleSelector)

  return render({title})
}

const Renderer = <T>({item, renderer}: {
  item: (render: (data: T) => ReactNode) => ReactNode
  renderer: (data: T) => ReactNode
}) => {
  return item(renderer)
}

const Root = ({condition}: {condition: boolean}) => {
  const render = ({title}) => <Layout title={title} />
  return <Renderer // type is  Renderer<{title: string}>
    item={render => {
      return condition
        ? <BlockA render={render} />
        : <BlockB render={render} />
    }}
    renderer={data => <Layout title={data.title} />}
  />
}
```

Now, finally, we can go to the magic part of the article. What we need is to get data of `Block#` and render it outside of it.

```react
const BlockA = (render) => {
  return render({title: "Block A"})
}

const BlockB = () => {
  const title = useSelector(titleSelector)

  return render({title})
}

const Renderer = <T>({item, renderer}: {
  item: (render: (data: T) => ReactNode) => ReactNode
  renderer: (data: T) => ReactNode
}) => {
  const [content, setContent] = useState(null)

  const subrender = (data) => {
    setContent(renderer(data))

    return null // returning null so component exists in virtual tree but missing in DOM tree
  }

  return <>
    {item(subrender)} // when item gets rendered it will set data!
    {content}
  </>
}

const Root = ({condition}: {condition: boolean}) => {
  const render = ({title}) => <Layout title={title} />
  return <Renderer // type is  Renderer<{title: string}>
    item={render => {
      return condition
        ? <BlockA render={render} />
        : <BlockB render={render} />
    }}
    renderer={data => <Layout title={data.title} />}
  />
}
```

Basically this is what we want to do theoretically, but practically code has few issues:
- `subrender` calls `setContent` which makes infinite rerender loop.
- Calling `setContent` when rendering will cause React warning that you can't do so.

Let's try to fix both issues:

```react
const BlockA = (render) => {
  return render({title: "Block A"})
}

const BlockB = () => {
  const title = useSelector(titleSelector)

  return render({title})
}

const Renderer = <T>({item, renderer}: {
  item: (render: (data: T) => ReactNode) => ReactNode
  renderer: (data: T) => ReactNode
}) => {
  const rc = useRef(0) // render count
  const [content, setContent] = useState(null)

  const subrender = (data) => {
    ++rc.current

    // we render only on odd times skipping even renders.
    if(rc.current % 2 === 1) {
      // We put content update into next event loop window to remove react warning
      setTimeout(() => {
        setContent(renderer(data))
      })
    }

    return null // returning null so component exists in virtual tree but missing in DOM tree
  }

  return <>
    {item(subrender)} // when item gets rendered it will set data!
    {content}
  </>
}

const Root = ({condition}: {condition: boolean}) => {
  const render = ({title}) => <Layout title={title} />
  return <Renderer // type is  Renderer<{title: string}>
    item={render => {
      return condition
        ? <BlockA render={render} />
        : <BlockB render={render} />
    }}
    renderer={data => <Layout title={data.title} />}
  />
}
```

And now everything works!

But we stumbled on another one issue. Out updates are now asynchorous which will become an issue if we want to try some synchronous form components such as `input`. Typing in input becomes less responsive, cursor always jumps to end of the value and so on. Indeed, we render every update on next event loop dispatch which causes desynchronisation of `input` inner and outer states. We can exaggerrate the problem by adding some timeout to `setInterval`:

```react
...
      setTimeout(() => {
        setContent(renderer(data))
      }, 1000)
...
```

Okay, maybe we can use `useEffect`? Let's convert everything to it:

```react
const BlockA = (render) => {
  return render({title: "Block A"})
}

const BlockB = () => {
  const title = useSelector(titleSelector)

  return render({title})
}

const Renderer = <T>({item, renderer}: {
  item: (render: (data: T) => ReactNode) => ReactNode
  renderer: (data: T) => ReactNode
}) => {
  const [content, setContent] = useState(null)

  const El = useCallback(() => {
    return item(data => {
      const rc = useRef(0) // render count

      useEffect(() => {
        rc.current = (rc.current + 1) & 0xff
        if (rc.current % 2 !== 1) return

        setContent(renderer(data))
      }, [data])

      return null
    })
  }, [item, renderer])

  return <>
    <El />
    {content}
  </>
}

const Root = ({condition}: {condition: boolean}) => {
  const render = ({title}) => <Layout title={title} />
  return <Renderer // type is  Renderer<{title: string}>
    item={render => {
      return condition
        ? <BlockA render={render} />
        : <BlockB render={render} />
    }}
    renderer={data => <Layout title={data.title} />}
  />
}
```

Okay, this works, but works the same way as the previous example. Somehow we need to call setContent in the same render cycle but avoid React warning. Wait, we have just the right tool for this — `useLayoutEffect`.

## Final Result ##

```react
const BlockA = (render) => {
  return render({title: "Block A"})
}

const BlockB = () => {
  const title = useSelector(titleSelector)

  return render({title})
}

const Renderer = <T>({item, renderer}: {
  item: (render: (data: T) => ReactNode) => ReactNode
  renderer: (data: T) => ReactNode
}) => {
  const [content, setContent] = useState(null)

  const El = useCallback(() => {
    return item(data => {
      const rc = useRef(0) // render count

      useLayoutEffect(() => {
        rc.current = (rc.current + 1) & 0xff
        if (rc.current % 2 !== 1) return

        setContent(renderer(data))
      }, [data])

      return null
    })
  }, [item, renderer])

  return <>
    <El />
    {content}
  </>
}

const Root = ({condition}: {condition: boolean}) => {
  const render = ({title}) => <Layout title={title} />
  return <Renderer // type is  Renderer<{title: string}>
    item={render => {
      return condition
        ? <BlockA render={render} />
        : <BlockB render={render} />
    }}
    renderer={data => <Layout title={data.title} />}
  />
}
```

Now everything works as good as it can be! Hope some time in future we will see some solution from React team to avoid this hack. Basically what we've done is two pass rendering. First we rendered `Block#` element to get its data and then we put it to renderer that got as `Layout` component. We moved from this tree:

```react
<Root>
  <BlockA>
    <Layout ... />
  </BlockA>
</Root>
```

to this one:

```react
<Root>
  <Renderer>
    <>
    null // first pass result
    <Layout ... /> // second pass result
    </>
  </Renderer>
</Root>
```

And this is what reconciler works fine with.