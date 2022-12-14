import { StandardLibrary } from './StandardLib'
import { Token, TokenTypes, canVisitTokens } from './Tokens'
import Stox from './Stox'
import { StackOperation } from './StackOperation'
class Interpreter {
  vm: Stox
  tokens: Token[]
  stack: Token[]
  ignoring: {}
  ptr: number
  operations: (string | StackOperation)[]
  step: number
  maxSteps: number
  programs: string[]
  maxDepth: number
  sourceTokens: Token[]

  constructor(vm: Stox) {
    canVisitTokens(this)
    this.vm = vm

    this.tokens = []
    this.sourceTokens = []
    this.stack = []
    this.ignoring = {}
    this.ptr = 0
    this.operations = []
    this.step = 0
    this.maxSteps = 2000
    this.maxDepth = 10
    this.programs = ['main']
  }
  loadSourceTokens(tokens: Token[]): void {
    // this.tokens.push(...tokens)
    this.sourceTokens = tokens.slice()
    this.tokens = this.getMacroTokens(null)
    // console.log(`${this.sourceTokens.length} tokens loaded`)
    // console.log(`${this.tokens.length} tokens ready to execute`)
  }
  interpret() {
    let executed = false
    this.operations.push(`╔════════╗`)
    try {
      while (!this.vm.hadError && this.getPtr() < this.tokens.length) {
        this.operations.push(this.interpretToken())
      }
      // exit to previous scope
    } catch (error) {
      // look for VM errors first
      if (error.token) {
        this.vm.error(error.token, error.message)
      } else {
        throw error
      }
    }
    this.operations.push(`╚════════╝`)
    return executed
  }

  interpretToken(): StackOperation {
    let token = this.peek()
    // console.log(`execToken '${token.lexeme}'#${this.ptr}`)
    if (this.step > this.maxSteps) {
      this.vm.error(token, 'Too many steps.')
      throw `INFINITE LOOP`
    } else {
      ///////////////////////////////
      // run token custom function //
      ///////////////////////////////
      let stackOp: StackOperation = this[`visit${token.type}token`](token)
      this.step += 1
      this.advancePtr()
      return stackOp
    }
  }

  expandMacro(token: Token) {
    // TODO: executed refinements for empty programs
    // create new stack operation

    let stackOp = new StackOperation(this, {
      token,
      added: [],
      removed: [],
    })
    this.operations.push(stackOp)
    // TODO: SAMEASMACRO same as executing a string's tokens
    // inline macro tokens
    let macroTokens = this.getMacroTokens(token)
    macroTokens.forEach((t) => {
      t.setParent(token)
    })
    this.tokens.splice(this.getPtr() + 1, 0, ...macroTokens)
    return stackOp
  }

  getMacroTokens(wordToken: Token | null): Token[] {
    // abc: abc;
    // take previous token as label
    let seekedToken = wordToken
      ? wordToken
      : new Token('STRING', 'main', 'main', 0, 0)
    let word = seekedToken.lexeme
    let macroTokens: Token[] = []
    let inMacros = {}
    let foundMacroBegin = wordToken ? false : true
    let foundMacroEnd = wordToken ? false : true
    for (let token of this.sourceTokens) {
      let lexeme = token.lexeme

      if (lexeme[lexeme.length - 1] === `:`) {
        // MACRO:
        let label = lexeme.slice(0, lexeme.length - 1)
        inMacros[label] = true
        if (label === word) foundMacroBegin = true
        // console.log(`at token ${token} starting label ${label}`)
      } else if (lexeme[lexeme.length - 1] === `;`) {
        let label = lexeme.slice(0, lexeme.length - 1)
        // MACRO;
        if (inMacros[label]) {
          inMacros[label] = false
          if (label === word) foundMacroEnd = true
          // console.log(`at token ${token} ending label ${label}`)
        } else {
          this.vm.error(token, 'Label finished without beginning.')
        }
      } else {
        // collect tokens and inline them
        let isWhitespace = ['WHITESPACE'].indexOf(token.type) !== -1
        let inMainNoMacros =
          !wordToken && !Object.keys(inMacros).some((mac) => inMacros[mac])
        let inCorrectMacro = inMacros[word] || inMainNoMacros

        // console.log({ isWhitespace, inCorrectMacro, inMainNoMacros })

        if (!isWhitespace && inCorrectMacro) {
          // collect macro token
          macroTokens.push(token)
          // console.log(`collecting ${seekedToken.lexeme}->${token.lexeme}`)
        } else {
          // ignore whitespace, comments and non-macro tokens
          // console.log(`ignoring ${seekedToken.lexeme}->${token.lexeme}`)
        }
      }
    }
    if (!foundMacroBegin)
      this.vm.error(seekedToken, 'No macro definition found')
    else if (!foundMacroEnd)
      this.vm.error(seekedToken, 'Macro definition unfinished found')
    return macroTokens
  }
  visitWORDtoken(token: Token) {
    let word = token.lexeme

    if (StandardLibrary[word] !== undefined) {
      // standard library word
      let operation: StackOperation = StandardLibrary[word](this, token)
      this.operations.push(operation)
    } else {
      this.expandMacro(token)
    }
  }
  visitSTRINGtoken(token: Token) {
    return this.addLiteralToken(token)
  }
  visitNUMBERtoken(token: Token) {
    return this.addLiteralToken(token)
  }
  visitNULLtoken(token: Token) {
    return this.addLiteralToken(token)
  }
  visitLABELtoken(token: Token) {}
  visitWHITESPACEtoken(token: Token) {}
  visitNEWLINEtoken(token: Token) {}
  visitCOMMENTtoken(token: Token) {}
  visitEOFtoken(token: Token) {}

  addLiteralToken(token: Token) {
    let newToken = new Token(
      token.type,
      token.lexeme,
      token.literal,
      token.xOff,
      token.yOff
    )

    let operation: StackOperation = StandardLibrary['push'](this, newToken)
    return operation
  }

  top(token: Token, depth: number): Token {
    if (depth < 0) {
      this.checkStackSize(token, Math.abs(depth))
      return this.stack[-depth - 1]
    } else {
      this.checkStackSize(token, depth + 1)
      return this.stack[this.stack.length - depth - 1]
    }
  }

  debugAt(depth) {
    let debugToken = new Token('STRING', 'DEBUG', null, 0, 0)
    // this.checkStackSize(debugToken, depth)
    return this.top(debugToken, depth)
  }

  pop(token: Token) {
    let element = this.top(token, 0)
    this.stack.pop()
    return element
  }

  delete(token: Token, depth: number) {
    if (depth < 0) {
      this.checkStackSize(token, Math.abs(depth))
      return this.stack.splice(-depth - 1, 1)
    } else if (depth >= 0) {
      this.checkStackSize(token, depth + 1)
      return this.stack.splice(this.stack.length - depth - 1, 1)
    }
  }

  pluck(token: Token, termA: number) {
    let elem = this.top(token, termA)
    this.delete(token, termA)
    return elem
  }

  place(token: Token, depth: number, element: Token) {
    this.checkStackSize(token, depth)
    // this.print(depth);
    this.checkInt(token, depth)
    if (depth >= 0) {
      this.stack.splice(this.stack.length - depth, 0, element)
    } else {
      this.stack.splice(-1 - depth, 0, element)
    }
  }

  indexOf(token: Token) {
    // 2 1 0
    let index = this.stack.length - this.stack.indexOf(token) - 2
    return index
  }

  print(msg: string) {
    this.vm.consoleText.push(msg)
  }

  output() {
    return this.stack.map((e) => e.literal)
  }

  checkBools(token: Token, n = 0) {
    // check 0 or 1
    for (let i = 0; i < n; i++) {
      // TODO: see if this is even allowed
      let value = <any>this.top(token, i)
      this.checkBool(token, value)
    }
  }

  checkBool(token: Token, value) {
    if ([1, 0].indexOf(value) === -1) {
      throw {
        token,
        message: `Must have bool operand. Found: ${value} of type ${typeof value}`,
      }
    }
  }

  checkStackSize(token, n = 0) {
    if (this.stack.length < n)
      throw { token, message: `Insufficient stack size: ${n}.` }
  }

  checkNumber(token, term) {
    if (!(!isNaN(parseFloat(term)) && isFinite(term))) {
      throw { token, message: `${term} is not a number.` }
    }
  }

  checkInt(token, term): boolean {
    if (!Number.isInteger(term)) {
      throw { token, message: `${term} is not an integer.` }
    }
    return true
  }

  checkPositiveNumber(token, term): boolean {
    this.checkNumber(token, term)
    if (term <= 0) {
      throw { token, message: `${term} is not positive.` }
    }
    return true
  }

  checkString(token, term): boolean {
    if (!(typeof term === 'string' || term instanceof String)) {
      throw { token, message: `${term} is not a string.` }
    }
    return true
  }

  peek() {
    return this.tokens[this.getPtr()]
  }

  getPtr() {
    return this.ptr
  }
  advancePtr() {
    this.ptr++
  }
}

export default Interpreter
