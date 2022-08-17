import { StandardLibrary } from './StandardLib'
import { Token, TokenTypes, canVisitTokens } from './Tokens'
import Pylox from './Pylox'
import { StackOperation } from './StackOperation'
class Interpreter {
  vm: Pylox
  tokens: Token[]
  stack: Token[]
  ignoring: {}
  ptr: number[]
  execOutput: (string | StackOperation)[]
  step: number
  maxSteps: number
  programs: string[]

  constructor(vm: Pylox) {
    canVisitTokens(this)

    this.vm = vm

    this.tokens = []
    this.stack = []
    this.ignoring = {}
    this.ptr = []
    this.execOutput = []
    this.step = 0
    this.maxSteps = 2000
    this.programs = ['main']
  }
  loadTokens(tokens: Token[]): void {
    this.tokens.push(...tokens)
  }
  addStackOperation(stackOp: StackOperation) {
    stackOp.token = this.peek()
    this.execOutput.push(stackOp)
  }
  interpret(token: Token | null = null) {
    let executed = false
    let silent = !this.shouldLog()
    // if (token) {
    //   let stackOp = new StackOperation(this, { added: [], removed: [token] })
    // }
    if (!silent) {
      this.execOutput.push(`╔════════╗`)
      // this.execOutput.push(`${this.programs.slice(1)}`)
      this.execOutput.push(`${this.programs[this.programs.length - 1]}`)
      // let stackOp = new StackOperation()
    }
    try {
      // start executing topmost program
      this.ptr.push(0)
      // gives error when using number and #
      while (!this.vm.hadError && this.getPtr() < this.tokens.length) {
        let executedNow = this.execToken()
        executed = executed || executedNow
        this.advancePtr()
      }
      // exit to previous scope
      this.ptr.pop()
    } catch (error) {
      // look for VM errors first
      if (error.token) {
        this.vm.error(error.token, error.message)
      } else {
        throw error
      }
    }

    if (!silent) {
      this.execOutput.push(`╚════════╝`)
    }
    return executed
  }

  execToken(): boolean {
    let token = this.peek()
    // console.log(`execToken '${token.lexeme}'#${this.ptr}`);
    // console.log(this.programs.toString());
    if (
      ['WHITESPACE', 'NEWLINE', 'LABEL', 'COMMENT'].indexOf(token.type) !== -1
    ) {
      // ignore whitespace and labels
      return false
    } else {
      let program = this.getProgram()

      // main program or specific program token
      if (
        (program === 'main' && token.programs.length === 0) ||
        (program !== 'main' && token.programs.indexOf(program) !== -1)
      ) {
        // console.log(`Accepting token @${this.ptr}{${token.lexeme} ${token.type}}`);
        if (this.step > this.maxSteps) {
          this.vm.error(token, 'Too many steps.')
          throw `INFINITE LOOP`
        } else {
          // run token
          token.accept(this)
          return true
        }
      } else {
        // console.log(`Skipping token @${this.ptr}{${token.lexeme} ${token.type}}`);
        return false
      }
    }
  }
  shouldLog() {
    // TODO: different logic needed here
    for (let program of this.programs) {
      if (this.vm.silentPrograms[program] === true) {
        return false
      }
    }
    return true
  }

  visitWORDtoken(token: Token) {
    let word = token.lexeme

    if (StandardLibrary[word] !== undefined) {
      // standard library word
      let operation: StackOperation = StandardLibrary[word](this, token)
      this.step += 1
      this.execOutput.push(operation)
    } else {
      // execute program
      // console.log(`Executing ${ word } program`);
      this.programs.push(word)
      // TODO: executed refinements for empty programs
      let stackOp = new StackOperation(this, { added: [], removed: [token] })
      this.step += 1
      this.addStackOperation(stackOp)
      let executed = this.interpret(token)
      if (!executed) {
        this.vm.error(token, `Word not found.`)
      }
      this.programs.pop()
      // this.execOutput.push(`end exec [${this.stack.slice().reverse().toString().padEnd(10, " ")}`);
    }

    // case 'exec':
    //   this.checkStackSize(token, 1)
    //   termA = this.stack.pop()
    //   this.visitWORDtoken({ lexeme: termA })
    //   break

    // case '!':
    //   this.checkStackSize(token, 1)
    //   this.checkBools(token, 1)
    //   this.stack.push(1 - Number(this.stack.pop()))
    //   break
  }
  visitSTRINGtoken(token: Token) {
    this.addLiteralToken(token)
  }
  visitNUMBERtoken(token: Token) {
    this.addLiteralToken(token)
  }
  visitNULLtoken(token: Token) {
    this.addLiteralToken(token)
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
    this.step += 1
    this.execOutput.push(operation)
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
    let index = this.stack.length - 1 - this.stack.indexOf(token)
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
      return false
    }
    return true
  }
  checkString(token, term): boolean {
    if (!(typeof term === 'string' || term instanceof String)) {
      throw { token, message: `${term} is not a string.` }
      return false
    }
    return true
  }

  peek() {
    return this.tokens[this.getPtr()]
  }

  advancePtr() {
    this.ptr[this.ptr.length - 1]++
  }

  getPtr() {
    return this.ptr[this.ptr.length - 1]
  }

  getProgram() {
    return this.programs[this.programs.length - 1]
  }
}

export default Interpreter